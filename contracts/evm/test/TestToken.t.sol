// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "../src/TestToken.sol";

contract TestTokenTest is Test {
    address issuer = address(0x15);
    address lot = address(0x10);
    TestToken t;

    function setUp() public {
        t = new TestToken(issuer, 1000e18);
    }

    function test_transferMovesBalance() public {
        vm.prank(issuer);
        t.transfer(lot, 10e18);
        assertEq(t.balanceOf(lot), 10e18);
    }

    function test_transferAboveBalanceReverts() public {
        vm.expectRevert();
        vm.prank(lot);
        t.transfer(issuer, 1);
    }

    function test_transferFromSpendsAllowance() public {
        vm.prank(issuer);
        t.approve(address(this), 5e18);
        t.transferFrom(issuer, lot, 5e18);
        assertEq(t.balanceOf(lot), 5e18);
        vm.expectRevert();
        t.transferFrom(issuer, lot, 1);
    }
}
