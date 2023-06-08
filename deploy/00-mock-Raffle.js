const { ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../helper-hardhat-config")

const BASE_FEE = ethers.utils.parseEther("0.25"); //0.25 is the premium Link per request
const GAS_PRICE_LINK = 1e9;// calculated value base on gasprice of chain

module.exports = async function({ getNamedAccounts, deployments}){
    const { deploy, log } = deployments;
    const { deployer } = await getNamedAccounts();
    const chainId = network.config.chainId;
    const args = [BASE_FEE, GAS_PRICE_LINK];

    if(chainId == 31337){
        log("Local network detected!")

        // deploy vrf coordinator mock
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args
        });

        log("Mocks deployed")
        log("----------------------------------------")
    }
}

module.exports.tags = ["all", "mocks"]