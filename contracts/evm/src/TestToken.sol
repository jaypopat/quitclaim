// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// The testnet token lots hold and Sablier streams are funded in. The whole supply goes to `to`.
contract TestToken is ERC20 {
    constructor(address to, uint256 amount) ERC20("Quitclaim Test Token", "QTT") {
        _mint(to, amount);
    }
}
