// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MockPriceOracle } from "../src/MockPriceOracle.sol";
import { WavefundPriceReceiver } from "../src/cre/WavefundPriceReceiver.sol";

contract DeployCREReceiver is Script {
    address private constant DEPLOYER = 0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2;
    address private constant KEEPER = 0xE7DD9a5fafa5739B466C61914311e39717f7192c;
    address private constant ORACLE = 0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d;
    address private constant SIM_FORWARDER = 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1;
    address private constant TRANSMITTER = 0xa2A470207A21f957e3c0223d77fb4B46fb32b8d8;
    uint64 private constant ARC_SELECTOR = 3034092155422581607;

    function run() external {
        require(block.chainid == 5_042_002, "Wrong chain");
        MockPriceOracle oracle = MockPriceOracle(ORACLE);
        bytes32 role = oracle.KEEPER_ROLE();
        require(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), DEPLOYER), "Deployer is not oracle admin");
        require(oracle.hasRole(role, KEEPER), "Existing keeper missing role");
        require(SIM_FORWARDER.code.length > 0, "Simulation forwarder has no code");

        vm.pauseTracing();
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerKey);
        address transmitter = vm.addr(vm.envUint("CRE_ETH_PRIVATE_KEY"));
        require(deployer == DEPLOYER, "Wrong deployer");
        require(transmitter == TRANSMITTER, "Wrong transmitter");
        vm.startBroadcast(deployerKey);
        vm.resumeTracing();

        WavefundPriceReceiver receiver = new WavefundPriceReceiver(SIM_FORWARDER, ORACLE, ARC_SELECTOR);
        receiver.setAllowedTransmitter(transmitter);
        oracle.grantRole(role, address(receiver));
        vm.stopBroadcast();

        require(receiver.allowedTransmitter() == TRANSMITTER, "Transmitter not configured");
        require(oracle.hasRole(role, address(receiver)), "Receiver role not granted");
        require(oracle.hasRole(role, KEEPER), "Existing keeper role changed");
        console2.log("Receiver:", address(receiver));
        console2.log("Allowed CRE transmitter:", transmitter);
    }
}
