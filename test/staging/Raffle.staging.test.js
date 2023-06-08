const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Staging Test", function () {
        let raffle, raffleEntranceFee, deployer;

        beforeEach(async function () {
            deployer = (await getNamedAccounts()).deployer;
            raffle = await ethers.getContract("Raffle", deployer);
            raffleEntranceFee = await raffle.getEntranceFee();
        })

        describe("fulfillRandomWrods", function () {
            it("works with live Chainlink Keepers and Chainlink VRF, we got a random winner", async function () {
                console.log("Setting up test...")
                const startingTimeStamp = await raffle.getLastTimeStamp();
                const accounts = await ethers.getSigners();

                console.log("Setting up listeners...")
                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => {
                        console.log("WinnerPicked event fired.")
                        try {
                            const recentWinner = await raffle.getRecentWinner();
                            const raffleState = await raffle.getRaffleState();
                            const winnerEndingBalance = await accounts[0].getBalance();
                            const endingTimeStamp = await raffle.getLastTimeStamp();

                            await expect(raffle.getPlayer(0)).to.be.reverted
                            assert.equal(recentWinner.toString(), accounts[0].address)
                            assert.equal(raffleState, 0);
                            assert.equal(
                                winnerEndingBalance.toString(), 
                                winnerStartingBalance.add(raffleEntranceFee).toString())
                            assert(endingTimeStamp > startingTimeStamp);
                            resolve()
                        } catch (error) {
                            reject(error)
                        }
                    })
                    const tx = await raffle.enterRaffle({ value: raffleEntranceFee });
                    await tx.wait(1)
                    console.log("Wait for Transaction");
                    const winnerStartingBalance = await accounts[0].getBalance();
                })
            })
        })
    })
