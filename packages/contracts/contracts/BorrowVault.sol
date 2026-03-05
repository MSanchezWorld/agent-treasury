// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IPool } from "./interfaces/IPool.sol";
import { IPoolAddressesProvider } from "./interfaces/IPoolAddressesProvider.sol";
import { IERC20 } from "./lib/IERC20.sol";
import { SafeERC20 } from "./lib/SafeERC20.sol";
import { Ownable } from "./lib/Ownable.sol";
import { ReentrancyGuard } from "./lib/ReentrancyGuard.sol";

/// @notice Per-user vault that supplies collateral to Aave and can borrow+pay under strict onchain policy guards.
/// @dev This is designed to be called by a verifiable offchain workflow (Chainlink CRE) via an authorized executor.
contract BorrowVault is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  uint256 public constant HF_SCALE = 1e18;
  uint256 public constant DAY = 1 days;
  uint256 public constant VARIABLE_RATE_MODE = 2;

  IPoolAddressesProvider public immutable aaveAddressesProvider;
  IPool public immutable pool;

  address public executor;
  bool public paused;

  // ---- Policy (MVP) ----
  uint256 public minHealthFactor; // 1e18, e.g. 1.6e18
  uint256 public cooldownSeconds;
  uint256 public maxBorrowPerTx; // assumed stablecoin units (e.g. USDC 6 decimals)
  uint256 public maxBorrowPerDay; // assumed stablecoin units (e.g. USDC 6 decimals)

  // ---- Safety / rate limits ----
  uint256 public lastExecutionAt;
  uint256 public dailyWindowStart;
  uint256 public dailyBorrowed;

  // ---- Replay protection ----
  uint256 public nonce;

  mapping(address => bool) public approvedCollateralTokens;
  mapping(address => bool) public approvedBorrowTokens;
  mapping(address => bool) public approvedPayees;

  event ExecutorUpdated(address indexed executor);
  event PausedUpdated(bool paused);
  event PolicyUpdated(uint256 minHealthFactor, uint256 cooldownSeconds, uint256 maxBorrowPerTx, uint256 maxBorrowPerDay);
  event TokenAllowlistUpdated(address indexed token, bool allowed, uint8 listKind);
  event PayeeAllowlistUpdated(address indexed payee, bool allowed);
  event CollateralSupplied(address indexed asset, uint256 amount);
  event CollateralWithdrawn(address indexed asset, uint256 amount, address indexed to);
  event DebtRepaid(address indexed asset, uint256 amount);
  event BorrowAndPayExecuted(
    uint256 indexed nonce,
    address indexed borrowAsset,
    uint256 borrowAmount,
    address indexed payee,
    uint256 planExpiresAt
  );

  error Paused();
  error NotExecutor();
  error InvalidPlan();
  error NotAllowlisted();
  error Cooldown();
  error Limit();
  error HealthFactorTooLow(uint256 hf);

  modifier onlyExecutor() {
    if (msg.sender != executor) revert NotExecutor();
    _;
  }

  modifier whenNotPaused() {
    if (paused) revert Paused();
    _;
  }

  constructor(address _owner, address _executor, address _aaveAddressesProvider) Ownable(_owner) {
    require(_executor != address(0), "EXECUTOR_0");
    require(_aaveAddressesProvider != address(0), "PROVIDER_0");

    executor = _executor;
    aaveAddressesProvider = IPoolAddressesProvider(_aaveAddressesProvider);
    pool = IPool(IPoolAddressesProvider(_aaveAddressesProvider).getPool());

    // Conservative defaults; owner should set explicitly.
    minHealthFactor = 16e17; // 1.6
    cooldownSeconds = 10 minutes;
    maxBorrowPerTx = 100e6; // $100 assuming 6 decimals stable
    maxBorrowPerDay = 200e6; // $200 assuming 6 decimals stable

    dailyWindowStart = block.timestamp;

    emit ExecutorUpdated(_executor);
    emit PolicyUpdated(minHealthFactor, cooldownSeconds, maxBorrowPerTx, maxBorrowPerDay);
  }

  // ---- Admin / policy ----

  function setExecutor(address _executor) external onlyOwner {
    require(_executor != address(0), "EXECUTOR_0");
    executor = _executor;
    emit ExecutorUpdated(_executor);
  }

  function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit PausedUpdated(_paused);
  }

  function setPolicy(uint256 _minHealthFactor, uint256 _cooldownSeconds, uint256 _maxBorrowPerTx, uint256 _maxBorrowPerDay)
    external
    onlyOwner
  {
    require(_minHealthFactor >= HF_SCALE, "HF_LT_1");
    minHealthFactor = _minHealthFactor;
    cooldownSeconds = _cooldownSeconds;
    maxBorrowPerTx = _maxBorrowPerTx;
    maxBorrowPerDay = _maxBorrowPerDay;
    emit PolicyUpdated(_minHealthFactor, _cooldownSeconds, _maxBorrowPerTx, _maxBorrowPerDay);
  }

  function setApprovedCollateralToken(address token, bool allowed) external onlyOwner {
    approvedCollateralTokens[token] = allowed;
    emit TokenAllowlistUpdated(token, allowed, 1);
  }

  function setApprovedBorrowToken(address token, bool allowed) external onlyOwner {
    approvedBorrowTokens[token] = allowed;
    emit TokenAllowlistUpdated(token, allowed, 2);
  }

  function setApprovedPayee(address payee, bool allowed) external onlyOwner {
    approvedPayees[payee] = allowed;
    emit PayeeAllowlistUpdated(payee, allowed);
  }

  // ---- Aave actions ----

  function supplyCollateral(address asset, uint256 amount) external onlyOwner whenNotPaused nonReentrant {
    if (!approvedCollateralTokens[asset]) revert NotAllowlisted();
    require(amount > 0, "AMOUNT_0");

    IPool _pool = pool;

    IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    IERC20(asset).forceApprove(address(_pool), amount);

    _pool.supply(asset, amount, address(this), 0);

    // Being explicit avoids surprises if Aave config changes.
    _pool.setUserUseReserveAsCollateral(asset, true);

    emit CollateralSupplied(asset, amount);
  }

  function withdrawCollateral(address asset, uint256 amount, address to) external onlyOwner whenNotPaused nonReentrant {
    require(to != address(0), "TO_0");
    require(amount > 0, "AMOUNT_0");

    IPool _pool = pool;
    uint256 withdrawn = _pool.withdraw(asset, amount, to);

    // Keep withdrawals "safe by default" to match the product policy model.
    _requireHealthFactor(_pool, minHealthFactor);

    emit CollateralWithdrawn(asset, withdrawn, to);
  }

  function repayDebt(address asset, uint256 amount) external onlyOwner whenNotPaused nonReentrant {
    if (!approvedBorrowTokens[asset]) revert NotAllowlisted();
    require(amount > 0, "AMOUNT_0");

    IPool _pool = pool;

    IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    IERC20(asset).forceApprove(address(_pool), amount);

    uint256 repaid = _pool.repay(asset, amount, VARIABLE_RATE_MODE, address(this));
    emit DebtRepaid(asset, repaid);
  }

  /// @notice Borrow stablecoin from Aave and pay a merchant/payee onchain.
  /// @param planExpiresAt Unix timestamp; prevents stale executions.
  /// @param planNonce Monotonically increasing nonce; prevents replay.
  function executeBorrowAndPay(
    address borrowAsset,
    uint256 borrowAmount,
    address payee,
    uint256 planExpiresAt,
    uint256 planNonce
  ) external onlyExecutor whenNotPaused nonReentrant {
    if (!approvedBorrowTokens[borrowAsset]) revert NotAllowlisted();
    if (!approvedPayees[payee]) revert NotAllowlisted();
    if (borrowAmount == 0) revert InvalidPlan();
    if (block.timestamp > planExpiresAt) revert InvalidPlan();
    if (planNonce != nonce + 1) revert InvalidPlan();

    if (cooldownSeconds != 0 && block.timestamp < lastExecutionAt + cooldownSeconds) revert Cooldown();

    _rollDailyWindowIfNeeded();

    if (borrowAmount > maxBorrowPerTx) revert Limit();
    if (dailyBorrowed + borrowAmount > maxBorrowPerDay) revert Limit();

    IPool _pool = pool;

    _pool.borrow(borrowAsset, borrowAmount, VARIABLE_RATE_MODE, 0, address(this));

    // Post-borrow HF check is sufficient — if HF was already too low, borrowing only
    // makes it worse so this single check catches both cases.
    _requireHealthFactor(_pool, minHealthFactor);

    IERC20(borrowAsset).safeTransfer(payee, borrowAmount);

    lastExecutionAt = block.timestamp;
    dailyBorrowed += borrowAmount;
    nonce = planNonce;

    emit BorrowAndPayExecuted(planNonce, borrowAsset, borrowAmount, payee, planExpiresAt);
  }

  function _rollDailyWindowIfNeeded() internal {
    if (block.timestamp < dailyWindowStart + DAY) return;

    // Reset the window starting at "now" (not calendar-based; good enough for MVP).
    dailyWindowStart = block.timestamp;
    dailyBorrowed = 0;
  }

  function _requireHealthFactor(IPool _pool, uint256 minHf) internal view {
    (, , , , , uint256 hf) = _pool.getUserAccountData(address(this));
    if (hf < minHf) revert HealthFactorTooLow(hf);
  }
}
