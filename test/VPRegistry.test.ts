import * as HRE from "hardhat";
import { Wallet, ContractReceipt } from "ethers";
import { isAddress } from "@ethersproject/address";
import { expect } from "chai";
import { step } from "mocha-steps";
import { keccak256 } from "ethers/lib/utils";
import { INetwork } from "models/Deploy";
import { IExpectedStatus } from "models/Test";
import { VPRegistry, VPRegistry__factory } from "typechain-types";
import { ADDR_ZERO, delay, setGlobalHRE } from "scripts/utils";
import { checkVpStatus } from "scripts/ssi";
import { randomUUID } from "crypto";
import { GAS_OPT, KEYSTORE, TEST } from "configuration";
import { generateWalletBatch } from "scripts/wallets";
import { Mnemonic } from "ethers/lib/utils";
import { Block, JsonRpcProvider } from "@ethersproject/providers";
import { PromiseOrValue } from "typechain-types/common";
import { GasModelSigner } from "@lacchain/gas-model-provider";

// General Contants
let ethers = HRE.ethers;
let provider: JsonRpcProvider;
let network: INetwork;

// Specific Constants
// -- revert Messages
const REVERT_MESSAGES = {
  initializable: { initialized: "Initializable: contract is already initialized" },
  register: {
    paramExp: "Expiration has to be greater than  now + 10 seconds",
    multipleSenders: "Cannot registrate hashes from multiple senders",
  },
  presented: {
    invalid: "This VP is not valid at this time",
    invState: "Must be in REGISTERED state",
    allowedVerifier: "Must be an allowed verifier to receive this VP",
  },
  consumed: {
    invState: "Must be in PRESENTED state",
    sameVerifier: "Only the same verifier can mark as consumed",
  },
  cancel: {
    invState: "Must be in REGISTERED state",
    samePreseter: "Only the presenter who registered the VP can cancel it",
  },
};
const VP_HASHES = {
  regularFlow: keccak256(
    Buffer.from("this could be a Verifiable Presentation" + randomUUID(), "utf-8")
  ),
  dates: keccak256(
    Buffer.from("this could be a Verifiable Presentation to test dates" + randomUUID(), "utf-8")
  ),
  cancel: keccak256(
    Buffer.from(
      "this could be a Verifiable Presentation to test cancel presentation" + randomUUID(),
      "utf-8"
    )
  ),
};
// use this to test a deployed Smart Contract
// else = undefined
const VPREGISTRY_DEPLOYED = undefined; //"0xe3831CDEB729Eb7DDCC25C379E2Bb54aFE0d7a2C";

// General variables
let accounts: GasModelSigner[];
// Specific variables
// -- Wallets/Signers
let admin: GasModelSigner;
let users: GasModelSigner[] = [];
let verifiers: GasModelSigner[] = [];
// -- Contracts
let vpRegFactory: PromiseOrValue<VPRegistry__factory>;
let vpReg: VPRegistry;
// -- allowed verifiers param
let allowedVerifiers: [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string
];
// -- keep track of the block where last Tx is mined
let lastReceipt: ContractReceipt;
let lastBlock: Block;

describe("VPRegistry", () => {
  before("Initialize environment", async () => {
    ({ gProvider: provider, gCurrentNetwork: network } = await setGlobalHRE(HRE));
    lastBlock = await provider.getBlock("latest");
    console.log(`Connected to network: ${network.name} (latest block: ${lastBlock.number})`);
    // Generate TEST.accountNumber wallets
    accounts = await generateWalletBatch(
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
    // set roles
    admin = accounts[0];
    for (let u = 0; u < TEST.userNumber; u++) {
      users[u] = accounts[u + 1];
    }
    for (let v = 0; v < TEST.verifierNumber; v++) {
      verifiers[v] = accounts[v + 1 + TEST.userNumber];
    }
    // Get VPRegistry Factory
    vpRegFactory = ethers.getContractFactory("VPRegistry", admin);
  });

  describe("Deploy and Initialization", () => {
    if (VPREGISTRY_DEPLOYED) {
      step("Should create contract instance", async () => {
        vpReg = (await vpRegFactory).attach(VPREGISTRY_DEPLOYED);
        expect(isAddress(vpReg.address)).to.be.true;
        console.log("VPRegistry recovered at: ", vpReg.address);
      });
    } else {
      step("Should deploy contract", async () => {
        vpReg = await (await (await vpRegFactory).deploy(GAS_OPT.max)).deployed();
        expect(isAddress(vpReg.address)).to.be.true;
        console.log("NEW VPRegistry deployed at: ", vpReg.address);
      });
    }

    it("Should subscribe contract EVENTS", async () => {
      // Initialized
      vpReg.on(vpReg.filters.Initialized(), (version) => {
        console.log(`VPRegistry initialized: { Version: ${version}}`);
      });
      // Registered
      vpReg.on(vpReg.filters.Registered(), (vphash, from, to) => {
        console.log(`New VP Registered: { VP hash: ${vphash}, from: ${from}, to: ${to} }`);
      });
      // Presented
      vpReg.on(vpReg.filters.Presented(), (vphash, verifier) => {
        console.log(`VP Presented: { VP hash: ${vphash}, verifier: ${verifier} }`);
      });
      // Consumed
      vpReg.on(vpReg.filters.Consumed(), (vphash, verifier) => {
        console.log(`VP Consumed: { VP hash: ${vphash}, verifier: ${verifier} }`);
      });
      // Status Changed
      vpReg.on(vpReg.filters.StatusChanged(), (vphash, from, to) => {
        console.log(`VP status changed: { VP hash: ${vphash}, from: ${from}, to: ${to} }`);
      });
      // Hash Valid
      vpReg.on(vpReg.filters.HashValid(), (vphash, valid) => {
        console.log(`VP valid changed: { VP hash: ${vphash}, valid: ${valid} }`);
      });
    });

    step("Should initialize contract", async () => {
      expect(await (await vpReg.initialize(GAS_OPT.max)).wait()).not.to.be.undefined;
    });

    it("Should FAIL initializing same contract again", async () => {
      expect(vpReg.initialize()).to.be.revertedWith(REVERT_MESSAGES.initializable.initialized);
    });
  });

  // register -> presented -> consumed
  describe("Regular Flow", () => {
    const vpHash = VP_HASHES.regularFlow;
    let expiration: number;
    let notBefore: number;
    let registeredAt: number;
    let updatedAt: number;

    before("Init Constants", async () => {
      // default signer for this tests
      vpReg = vpReg.connect(users[0]);
      allowedVerifiers = [
        verifiers[0].address,
        verifiers[1].address,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
      ];
    });

    // UNREGISTERED
    step("Should check status fields", async () => {
      await checkVpStatus(vpReg, vpHash, {
        found: false,
        valid: false,
        state: 0,
        allowedVerifiers: [
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
          ADDR_ZERO,
        ],
        finalVerifier: ADDR_ZERO,
        rat: 0,
        uat: 0,
        exp: 0,
        nbf: 0,
      } as IExpectedStatus);
    });

    step("Should register a new VP hash", async () => {
      expiration = Math.floor(Date.now() / 1000) + 60;
      notBefore = 0;
      const receipt = await (
        await vpReg.register(vpHash, allowedVerifiers, expiration, notBefore, GAS_OPT.max)
      ).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      registeredAt = lastBlock.timestamp;
      updatedAt = registeredAt;
    });

    step("Should check status fields", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: true,
        state: 1, // REGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    // REGISTERED

    step("Should be able to register the same VP hash again", async () => {
      expiration = Math.floor(Date.now() / 1000) + 60;
      notBefore = 0;
      const receipt = await (
        await vpReg.register(vpHash, allowedVerifiers, expiration, notBefore, GAS_OPT.max)
      ).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      registeredAt = lastBlock.timestamp;
      updatedAt = registeredAt;
    });

    it("Should FAIL to register same hash from another user", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect(
          (
            await vpReg
              .connect(users[1])
              .register(
                vpHash,
                allowedVerifiers,
                Math.floor(Date.now() / 1000) + 60,
                0,
                GAS_OPT.max
              )
          ).wait()
        ).to.be.reverted;
      } else {
        await expect(
          vpReg
            .connect(users[1])
            .register(vpHash, allowedVerifiers, Math.floor(Date.now() / 1000) + 60, 0)
        ).to.be.revertedWith(REVERT_MESSAGES.register.multipleSenders);
      }
    });

    it("Should FAIL to mark VP as presented from NOT allowed verifier", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(users[1]).presented(vpHash, GAS_OPT.max)).wait()).to.be
          .reverted;
      } else {
        await expect(vpReg.connect(users[1]).presented(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.presented.allowedVerifier
        );
      }
    });

    step("Should mark as presented the VP hash", async () => {
      // wait one second between registered and updated
      await delay(1000);
      const receipt = await (
        await vpReg.connect(verifiers[0]).presented(vpHash, GAS_OPT.max)
      ).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      updatedAt = lastBlock.timestamp;
    });

    step("Should check status fields", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: true,
        state: 2, // PRESENTED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: verifiers[0].address,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    // PRESENTED

    it("Should FAIL to mark as presented the VP hash again", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(verifiers[0]).presented(vpHash, GAS_OPT.max)).wait()).to
          .be.reverted;
      } else {
        await expect(vpReg.connect(verifiers[0]).presented(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.presented.invState
        );
      }
    });

    it("Should FAIL to mark VP as consumed from other verifier", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(verifiers[1]).consumed(vpHash, GAS_OPT.max)).wait()).to.be
          .reverted;
      } else {
        await expect(vpReg.connect(verifiers[1]).consumed(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.consumed.sameVerifier
        );
      }
    });

    step("Should mark as consumed the VP hash", async () => {
      const receipt = await (
        await vpReg.connect(verifiers[0]).consumed(vpHash, GAS_OPT.max)
      ).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      updatedAt = lastBlock.timestamp;
    });

    step("Should check status fields", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: true,
        state: 3, // CONSUMED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: verifiers[0].address,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    it("Should FAIL to mark VP as consumed the VP hash again", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(verifiers[0]).consumed(vpHash, GAS_OPT.max)).wait()).to.be
          .reverted;
      } else {
        await expect(vpReg.connect(verifiers[0]).consumed(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.consumed.invState
        );
      }
    });

    after("Wait for events", async () => {
      if (network.name == "ganache") {
        await delay(2000); // 2 sec
      }
    });
  });

  describe("VPRegistry - Dates", () => {
    const vpHash = VP_HASHES.dates;
    let expiration: number;
    let notBefore: number;
    let registeredAt: number;
    let updatedAt: number;

    before("Init Constants", async () => {
      // default signer for this tests
      vpReg = vpReg.connect(users[0]);

      allowedVerifiers = [
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
      ];
    });

    // UNREGISTERED

    it("Should FAIL to register hash with invalid expiration", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect(
          (
            await vpReg.register(
              vpHash,
              allowedVerifiers,
              Math.floor(Date.now() / 1000),
              0,
              GAS_OPT.max
            )
          ).wait()
        ).to.be.reverted;
      } else {
        await expect(
          vpReg.register(vpHash, allowedVerifiers, Math.floor(Date.now() / 1000), 0)
        ).to.be.revertedWith(REVERT_MESSAGES.register.paramExp);
      }
    });

    step("Should check status fields", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: false,
        valid: false,
        state: 0, // UNREGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: 0,
        uat: 0,
        exp: 0,
        nbf: 0,
      } as IExpectedStatus);
    });

    step("Should register a new VP hash", async () => {
      // this hash will be valid 5 seconds after registered and will be expired after another 6 seconds
      expiration = Math.floor(Date.now() / 1000) + 25;
      notBefore = Math.floor(Date.now() / 1000) + 15;
      const receipt = await (
        await vpReg.register(vpHash, allowedVerifiers, expiration, notBefore, GAS_OPT.max)
      ).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      registeredAt = lastBlock.timestamp;
      updatedAt = registeredAt;
    });

    step("Should check status fields right after registered", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: false,
        state: 1, // REGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    // REGISTERED

    it("Should FAIL to mark VP as presented a invalid (not before) hash", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(verifiers[0]).presented(vpHash, GAS_OPT.max)).wait()).to
          .be.reverted;
      } else {
        await expect(vpReg.connect(verifiers[0]).presented(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.presented.invalid
        );
      }
    });

    it("Should check status fields after notBefore", async () => {
      //await delay(6000); // 6 seconds
      // wait until notBefore
      let now = Math.floor(Date.now() / 1000);
      while (now <= notBefore) {
        await delay(1000);
        now = Math.floor(Date.now() / 1000);
      }

      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: true,
        state: 1, // REGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    it("Should check status fields after expired", async () => {
      //await delay(6000); // 6 seconds
      // wait until expiration
      let now = Math.floor(Date.now() / 1000);
      while (now <= expiration) {
        await delay(1000);
        now = Math.floor(Date.now() / 1000);
      }
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: false,
        state: 1, // REGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    it("Should FAIL to mark VP as presented a invalid (expired) hash", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(verifiers[0]).presented(vpHash, GAS_OPT.max)).wait()).to
          .be.reverted;
      } else {
        await expect(vpReg.connect(verifiers[0]).presented(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.presented.invalid
        );
      }
    });

    after("Wait for events", async () => {
      if (network.name == "ganache") {
        await delay(2000); // 2 sec
      }
    });
  });

  describe("VPRegistry - Cancel Verifiable Presentation flow", () => {
    const vpHash = VP_HASHES.cancel;
    let expiration: number;
    let notBefore: number;
    let registeredAt: number;
    let updatedAt: number;

    before("Init Constants", async () => {
      // default signer for this tests
      vpReg = vpReg.connect(users[0]);

      allowedVerifiers = [
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
        ADDR_ZERO,
      ];
    });

    // UNREGISTERED

    step("Should check status fields", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: false,
        valid: false,
        state: 0, // UNREGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: 0,
        uat: 0,
        exp: 0,
        nbf: 0,
      } as IExpectedStatus);
    });

    step("Should register a new VP hash", async () => {
      expiration = Math.floor(Date.now() / 1000) + 60;
      notBefore = Math.floor(Date.now() / 1000);
      const receipt = await (
        await vpReg.register(vpHash, allowedVerifiers, expiration, notBefore, GAS_OPT.max)
      ).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      registeredAt = lastBlock.timestamp;
      updatedAt = registeredAt;
    });

    step("Should check status fields right after registered", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: true,
        state: 1, // REGISTERED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    // REGISTERED

    it("Should FAIL to mark VP as canceled from ther user", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.connect(users[1]).cancel(vpHash, GAS_OPT.max)).wait()).to.be
          .reverted;
      } else {
        await expect(vpReg.connect(users[1]).cancel(vpHash)).to.be.revertedWith(
          REVERT_MESSAGES.cancel.samePreseter
        );
      }
    });

    step("Should mark VP hash as canceled", async () => {
      const receipt = await (await vpReg.cancel(vpHash, GAS_OPT.max)).wait();
      expect(receipt).not.to.be.undefined;
      lastBlock = await ethers.provider.getBlock(receipt.blockHash);
      updatedAt = lastBlock.timestamp;
    });

    it("Should check status fields", async () => {
      await checkVpStatus(    vpReg, vpHash, {
        found: true,
        valid: true,
        state: 10, // CANCELED
        allowedVerifiers: allowedVerifiers,
        finalVerifier: ADDR_ZERO,
        rat: registeredAt,
        uat: updatedAt,
        exp: expiration,
        nbf: notBefore,
      } as IExpectedStatus);
    });

    it("Should FAIL to mark VP as canceled from other state than registered", async () => {
      if (network.name.includes("lacchain")) {
        // If lacchain network
        await expect((await vpReg.cancel(vpHash, GAS_OPT.max)).wait()).to.be.reverted;
      } else {
        await expect(vpReg.cancel(vpHash)).to.be.revertedWith(REVERT_MESSAGES.cancel.invState);
      }
    });

    after("Wait for events", async () => {
      if (network.name == "ganache") {
        await delay(2000); // 2 sec
      }
    });
  });
});
