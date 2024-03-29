import { CONTRACTS, GAS_OPT, KEYSTORE, TEST } from "configuration";
import * as HRE from "hardhat";
import { step } from "mocha-steps";
import { expect } from "chai";
import { ContractReceipt, Wallet } from "ethers";
import { TransactionReceipt, Block, JsonRpcProvider } from "@ethersproject/providers";
import { Mnemonic, isAddress, parseEther } from "ethers/lib/utils";
import { generateWallets } from "scripts/wallets";
import { ADDR_ZERO, getContractInstance, setGlobalHRE } from "scripts/utils";
import { INetwork } from "models/Configuration";
import { deploy } from "scripts/deploy";
import { IStorage } from "typechain-types/artifacts/contracts/interfaces";
import { Ownable } from "typechain-types/artifacts/@openzeppelin/contracts/access";
import { deployWithContractDeployer } from "scripts/standardContractRegistry";
import { trustCodeAt } from "scripts/decentralizedCodeTrust";
import { IContractDeployer } from "standard-contract-registry/typechain-types";
import { ICodeTrust } from "decentralized-code-trust/typechain-types";

// Specific Constants
const CONTRACT_NAME = "Storage";
const STORAGE_DEPLOYED_AT = undefined;
const INIT_VALUE = 12;

// General Variables
let provider: JsonRpcProvider;
let network: INetwork;
let accounts: Wallet[];
let lastReceipt: ContractReceipt | TransactionReceipt;
let lastBlock: Block;
// Specific Variables
// -- wallets | accounts
let admin: Wallet;
let defaultUser: Wallet;
// -- contracts
let storage: IStorage & Ownable;
describe("Storage", () => {
  before("Generate test Accounts", async () => {
    ({ gProvider: provider, gNetwork: network } = await setGlobalHRE(HRE));
    lastBlock = await provider.getBlock("latest");
    console.log(`Connected to network: ${network.name} (latest block: ${lastBlock.number})`);
    // Generate TEST.accountNumber wallets
    accounts = await generateWallets(
      undefined,
      undefined,
      TEST.accountNumber,
      undefined,
      {
        phrase: KEYSTORE.default.mnemonic.phrase,
        path: KEYSTORE.default.mnemonic.basePath,
        locale: KEYSTORE.default.mnemonic.locale,
      } as Mnemonic,
      true
    );
    // set specific roles
    admin = accounts[0];
    defaultUser = accounts[1];
  });

  describe("Difference between OffChain and OnChain deployment", () => {
    step("Should deploy same contract with and without ContractDeployer", async () => {
      const codeTrust = await getContractInstance<ICodeTrust>("CodeTrust", admin);
      const offDeployResult = await deploy(
        "ContractRegistry",
        admin,
        [codeTrust.address],
        GAS_OPT.max,
        {
          offChain: false,
          onChain: false,
        }
      );
      // On chain
      const contractDeployer = await getContractInstance<IContractDeployer>(
        "ContractDeployer",
        admin
      );
      await trustCodeAt(contractDeployer.address, admin);
      const onDeployResult = await deployWithContractDeployer(
        "ContractRegistry",
        "Random_Name_02",
        admin,
        [codeTrust.address],
        GAS_OPT.max,
        "01.00",
        undefined,
        contractDeployer
      );
      const offChainTx = provider.getTransactionReceipt(offDeployResult.deployment?.deployTxHash!);
      // TODO: use tx hash from new SCR version
      const onChainTx = provider.getTransactionReceipt(
        (await provider.getBlockWithTransactions(provider.getBlockNumber())).transactions[0].hash
      );
      const absDiff = (await onChainTx).gasUsed.sub((await offChainTx).gasUsed);
      const relativeDiff = absDiff.mul(100).div((await onChainTx).gasUsed);
      console.log(
        `Off Chain contract deployment: ${(await offChainTx).gasUsed}`,
        `\nOn Chain contract deployment: ${(await onChainTx).gasUsed}`,
        `\nDifference or Overhead: ${absDiff} (${relativeDiff} %) gas units more than off chain deployment`
      );
    });
  });

  describe("Deployment and Initialization", () => {
    if (STORAGE_DEPLOYED_AT) {
      step("Should create contract instance", async () => {
        storage = await getContractInstance<IStorage & Ownable>(CONTRACT_NAME, admin);
        expect(isAddress(storage.address)).to.be.true;
        expect(storage.address).to.equal(STORAGE_DEPLOYED_AT);
        console.log(`${CONTRACT_NAME} recovered at: ${storage.address}`);
      });
    } else {
      step("Should deploy contract", async () => {
        const deployResult = await deploy(CONTRACT_NAME, admin, [INIT_VALUE], GAS_OPT.max, {
          offChain: false,
          onChain: false,
        });
        storage = deployResult.contractInstance as IStorage & Ownable;
        expect(isAddress(storage.address)).to.be.true;
        expect(storage.address).not.to.equal(ADDR_ZERO);
        console.log(`NEW ${CONTRACT_NAME} deployed at: ${storage.address}`);
      });
      step("Should check if correct initialization", async () => {
        const response = await storage.retrieve();
        expect(response).equal(INIT_VALUE);
      });
    }
  });

  describe("Main", () => {
    before("Set the correct signer", async () => {
      storage = storage.connect(defaultUser);
    });
    step("Should store new value", async () => {
      // check initial state
      const previous = await storage.retrieve();
      expect(previous).equal(INIT_VALUE);
      // change stored value
      const newValue = 21;
      lastReceipt = await (await storage.store(newValue, GAS_OPT.max)).wait();
      expect(lastReceipt).not.to.be.undefined;
      const events = await storage.queryFilter(
        storage.filters.Stored(newValue),
        lastReceipt.blockNumber,
        lastReceipt.blockNumber
      );
      expect(events.length).to.equal(1);
      // check final state
      const final = await storage.retrieve();
      expect(final).to.equal(newValue);
    });
  });

  describe("Owner", () => {
    before("Set the correct signer", async () => {
      storage = storage.connect(admin);
    });

    step("Should transfer ownership", async () => {
      // check initial state
      const previous = await storage.owner();
      expect(previous).equal(admin.address);
      // change owner
      lastReceipt = await (
        await storage.transferOwnership(defaultUser.address, GAS_OPT.max)
      ).wait();
      expect(lastReceipt).not.to.be.undefined;
      const events = await storage.queryFilter(
        storage.filters.OwnershipTransferred(admin.address, defaultUser.address),
        lastReceipt.blockNumber,
        lastReceipt.blockNumber
      );
      expect(events.length).to.equal(1);
      // check final state
      const final = await storage.owner();
      expect(final).to.equal(defaultUser.address);
    });

    step("Should transfer back the ownership", async () => {
      // check initial state
      const previous = await storage.owner();
      expect(previous).equal(defaultUser.address);
      // change owner
      lastReceipt = await (
        await storage.connect(defaultUser).transferOwnership(admin.address, GAS_OPT.max)
      ).wait();
      expect(lastReceipt).not.to.be.undefined;
      const events = await storage.queryFilter(
        storage.filters.OwnershipTransferred(defaultUser.address, admin.address),
        lastReceipt.blockNumber,
        lastReceipt.blockNumber
      );
      expect(events.length).to.equal(1);
      // check final state
      const final = await storage.owner();
      expect(final).to.equal(admin.address);
    });
  });

  describe("PayMe", () => {
    before("Set the correct signer", async () => {
      storage = storage.connect(defaultUser);
    });
    step("Should pay the owner of the contract", async () => {
      const amount = parseEther("13.0");
      // check initial state
      const initBalances = {
        admin: await provider.getBalance(admin.address),
        defaultUser: await provider.getBalance(defaultUser.address),
      };
      expect(initBalances.admin).greaterThanOrEqual(0);
      expect(initBalances.defaultUser).greaterThanOrEqual(0);
      // pay contract
      lastReceipt = await (await storage.payMe({ ...GAS_OPT.max, value: amount })).wait();
      expect(lastReceipt).not.to.be.undefined;
      const events = await storage.queryFilter(
        storage.filters.ThankYou(undefined, defaultUser.address),
        lastReceipt.blockNumber,
        lastReceipt.blockNumber
      );
      expect(events.length).to.equal(1);
      // check final state
      const finalBalances = {
        admin: await provider.getBalance(admin.address),
        defaultUser: await provider.getBalance(defaultUser.address),
      };
      expect(finalBalances.admin.gte(initBalances.admin)).to.be.true;
      expect(finalBalances.defaultUser.lte(initBalances.defaultUser)).to.be.true;
    });
  });
});
