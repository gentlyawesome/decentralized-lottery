const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Test", function () {
        let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
        const chainId = network.config.chainId;

        beforeEach(async function () {
            accounts = await ethers.getSigners();
            // deployer = 0
            player = accounts[1]
            await deployments.fixture(["all", "raffle"])
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
            raffleContract = await ethers.getContract("Raffle");
            raffle = raffleContract.connect(player); 
            raffleEntranceFee = await raffle.getEntranceFee();
            interval = await raffle.getInterval();
        })

        describe("constructor", function () {
            it("initialize the raffle correctly", async function () {
                const raffleState = await raffle.getRaffleState();
                const interval = await raffle.getInterval();
                assert.equal(raffleState.toString(), "0")
                assert.equal(interval.toString(), networkConfig[chainId]["interval"])
            })
        })

        describe("enterRaffle", function () {
            it("revert if you do not pay enough", async function () {
                await expect(raffle.enterRaffle()).to.be.revertedWithCustomError(raffle, "Raffle__NotEnoughETHEntered")
            })

            it("records players when they enter", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                const playerFromContract = await raffle.getPlayer(0);
                assert.equal(player.address, playerFromContract);
            })

            it("emits even on enter", async function () {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(raffle, "RaffleEnter")
            })

            it("doesn't allow entrance when raffle is calculating", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                // Pretend Chainlink Keeper
                await raffle.performUpkeep([]);
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWithCustomError(raffle, "Raffle__NotOpen");
            })
        })

        describe("checkUpkeep", function () {
            it("returns false if people haven't sent ETH", async function () {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                assert(!upkeepNeeded);
            })

            it("returns false if raffle isn't open", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                await raffle.performUpkeep([]);
                const raffleState = await raffle.getRaffleState();
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                assert.equal(raffleState.toString(), "1");
                assert.equal(upkeepNeeded, false);
            })

            it("returns false if raffle time passed", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]);
                await network.provider.request({ method: "evm_mine", params: [] });
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                assert(!upkeepNeeded);
            })

            it("returns true if enough time passed, has players, eth and is open", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                assert(upkeepNeeded);
            })
        })

        describe("performUpkeep", function () {
            it("it can only return if checkupkeep is true", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                const tx = await raffle.performUpkeep([]);
                assert(tx);
            })

            it("revert if checkupkeep false", async function () {
                await expect(raffle.performUpkeep([])).to.be.revertedWithCustomError(raffle, "Raffle__UpkeepNotNeeded")
            })

            it("updates the raffle state, emits an event, and calls vrf coordinator", async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                const txResponse = await raffle.performUpkeep([]);
                const txReceipt = await txResponse.wait(1);
                const requestId = txReceipt.events[1].args.requestId;
                const raffleState = await raffle.getRaffleState();
                assert(requestId.toNumber() > 0);
                assert(raffleState.toString() == "1");
            })
        })

        describe("fulfillRandomWords", function () {
            beforeEach(async function () {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
            })

            it("can only be called after performUpkeep", async function () {
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith("nonexistent request")
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith("nonexistent request")
            })

            it("picks a winner, resets the lottery, and sends money", async function () {
                const additionalEntrants = 3;
                const startingAccountIndex = 2; // deployer = 0
                for (let index = startingAccountIndex; index < startingAccountIndex + additionalEntrants; index++) {
                    raffle = raffleContract.connect(accounts[index]);
                    await raffle.enterRaffle({ value : raffleEntranceFee });
                }
                   
                const startingTimeStamp = await raffle.getLastTimeStamp();
                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => {
                        console.log("Found the Event!")
                        try {
                            const recentWinner = await raffle.getRecentWinner();
                            const raffleState = await raffle.getRaffleState();
                            const endingTimeStamp = await raffle.getLastTimeStamp();
                            const numPlayers = await raffle.getNumberOfPlayers();
                            const winnerBalance = await accounts[2].getBalance();
                            assert.equal(numPlayers.toString(), "0");
                            assert.equal(raffleState.toString(), "0");
                            assert.equal(
                                winnerBalance.toString(), 
                                startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                    .add(
                                        raffleEntranceFee
                                            .mul(additionalEntrants)
                                            .add(raffleEntranceFee)
                                    )
                                    .toString()
                            )
                            assert(endingTimeStamp > startingTimeStamp);

                        } catch (e) {
                            reject(e)
                        }
                        resolve();
                    })

                    const tx = await raffle.performUpkeep([]);
                    const txReceipt = await tx.wait(1);
                    const startingBalance = await accounts[2].getBalance();
                    await vrfCoordinatorV2Mock.fulfillRandomWords(txReceipt.events[1].args.requestId, raffle.address);
                })
            })
        })
    })