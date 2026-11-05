// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockToken {
    string public constant name = "Mock Locked Token";
    string public constant symbol = "MLT";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(address to, uint256 amount) {
        balanceOf[to] = amount;
        totalSupply = amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}

/// Non-transferable linear vesting. Beneficiary is fixed forever.
/// `claim(to)` never reverts for the beneficiary, even with nothing vested,
/// so a retained claim at a nonce still consumes that nonce with status 1.
contract MockVesting {
    MockToken public immutable token;
    address public immutable beneficiary;
    address public immutable admin;
    uint64 public immutable start;
    uint64 public end;
    uint256 public immutable total;
    uint256 public claimed;

    event Claimed(address indexed to, uint256 amount, uint256 totalClaimed);
    event SpedUp(uint64 newEnd);

    error NotBeneficiary();
    error NotAdmin();
    error NotEarlier();

    constructor(address beneficiary_, uint64 duration, uint256 total_) {
        beneficiary = beneficiary_;
        admin = msg.sender;
        start = uint64(block.timestamp);
        end = start + duration;
        total = total_;
        token = new MockToken(address(this), total_);
    }

    function vested() public view returns (uint256) {
        if (block.timestamp >= end) return total;
        return (total * (block.timestamp - start)) / (end - start);
    }

    function claimable() public view returns (uint256) {
        return vested() - claimed;
    }

    function claim(address to) external returns (uint256 amount) {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        amount = claimable();
        claimed += amount;
        if (amount > 0) token.transfer(to, amount);
        emit Claimed(to, amount, claimed);
    }

    function speedUp(uint64 newEnd) external {
        if (msg.sender != admin) revert NotAdmin();
        if (newEnd >= end) revert NotEarlier();
        if (newEnd < block.timestamp) newEnd = uint64(block.timestamp);
        end = newEnd;
        emit SpedUp(newEnd);
    }
}
