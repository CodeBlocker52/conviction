// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MockPriceOracle } from "../src/MockPriceOracle.sol";
import { WavefundPriceReceiver } from "../src/cre/WavefundPriceReceiver.sol";

address constant FRESH_CRE_FORWARDER = 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1;
address constant FRESH_CRE_TRANSMITTER = 0xa2A470207A21f957e3c0223d77fb4B46fb32b8d8;
uint64 constant FRESH_ARC_SELECTOR = 3_034_092_155_422_581_607;

contract DeployFreshCREReceiver is Script {
    function run() external {
        require(block.chainid == 5_042_002, "Wrong chain");

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envAddress("KEEPER_ADDR");
        address oracleAddress = vm.envAddress("NEW_PRICE_ORACLE");
        MockPriceOracle oracle = MockPriceOracle(oracleAddress);
        bytes32 keeperRole = oracle.KEEPER_ROLE();

        require(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), deployer), "Deployer is not oracle admin");
        require(oracle.hasRole(keeperRole, keeper), "Keeper role missing on new oracle");
        require(FRESH_CRE_FORWARDER.code.length > 0, "Simulation forwarder has no code");

        vm.startBroadcast(deployerPk);
        WavefundPriceReceiver receiver =
            new WavefundPriceReceiver(FRESH_CRE_FORWARDER, oracleAddress, FRESH_ARC_SELECTOR);
        receiver.setAllowedTransmitter(FRESH_CRE_TRANSMITTER);
        oracle.grantRole(keeperRole, address(receiver));
        vm.stopBroadcast();

        require(receiver.allowedTransmitter() == FRESH_CRE_TRANSMITTER, "Transmitter not configured");
        require(oracle.hasRole(keeperRole, address(receiver)), "Receiver role not granted");
        require(oracle.hasRole(keeperRole, keeper), "Keeper role changed");
        console2.log("WavefundPriceReceiver:", address(receiver));
        console2.log("Allowed CRE transmitter:", FRESH_CRE_TRANSMITTER);
    }
}
