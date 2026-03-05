// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "./IERC20.sol";

library SafeERC20 {
  function safeTransfer(IERC20 token, address to, uint256 value) internal {
    (bool ok, bytes memory data) =
      address(token).call(abi.encodeWithSelector(token.transfer.selector, to, value));
    require(ok && (data.length == 0 || abi.decode(data, (bool))), "SAFE_TRANSFER_FAILED");
  }

  function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
    (bool ok, bytes memory data) =
      address(token).call(abi.encodeWithSelector(token.transferFrom.selector, from, to, value));
    require(ok && (data.length == 0 || abi.decode(data, (bool))), "SAFE_TRANSFER_FROM_FAILED");
  }

  function safeApprove(IERC20 token, address spender, uint256 value) internal {
    (bool ok, bytes memory data) = address(token).call(abi.encodeWithSelector(token.approve.selector, spender, value));
    require(ok && (data.length == 0 || abi.decode(data, (bool))), "SAFE_APPROVE_FAILED");
  }

  /// @dev Sets allowance to `value`, resetting to 0 first only if needed (for USDT-like tokens).
  function forceApprove(IERC20 token, address spender, uint256 value) internal {
    (bool ok, bytes memory data) = address(token).call(abi.encodeWithSelector(token.approve.selector, spender, value));
    if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
      safeApprove(token, spender, 0);
      safeApprove(token, spender, value);
    }
  }
}

