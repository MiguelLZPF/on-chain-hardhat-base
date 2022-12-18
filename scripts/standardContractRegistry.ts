import { CONTRACT, GAS_OPT } from "configuration";
import { ghre } from "scripts/utils";
import { Signer } from "ethers";
import { isAddress, keccak256, formatBytes32String, BytesLike } from "ethers/lib/utils";
import { TransactionReceipt } from "@ethersproject/providers";
import yesno from "yesno";
import { IRegularDeployment } from "models/Deploy";
// Artifacts
import * as CODE_TRUST_ARTIFACT from "node_modules/decentralized-code-trust/artifacts/contracts/CodeTrust.sol/CodeTrust.json";
import * as CONTRACT_REGISTRY_ARTIFACT from "node_modules/standard-contract-registry/artifacts/contracts/ContractRegistry.sol/ContractRegistry.json";
import * as CONTRACT_DEPLOYER_ARTIFACT from "node_modules/standard-contract-registry/artifacts/contracts/ContractDeployer.sol/ContractDeployer.json";
import {
  ContractDeployer__factory,
  ContractRegistry__factory,
  IContractDeployer,
  IContractRegistry,
} from "typechain-types";

const ethers = ghre.ethers;
const NAME_HEXSTRING_ZERO = formatBytes32String("");
// Deploy contract code
const CODETRUST_DEP_CODE = CODE_TRUST_ARTIFACT.deployedBytecode;
const REGISTRY_DEP_CODE = CONTRACT_REGISTRY_ARTIFACT.deployedBytecode;
const DEPLOYER_DEP_CODE = CONTRACT_DEPLOYER_ARTIFACT.deployedBytecode;

const deployCodeTrust = async (deployer: Signer) => {
  if (CONTRACT.codeTrust.address) {
    const yes = await yesno({
      question: `Contract ${CONTRACT.codeTrust.name} has an address set to ${CONTRACT.codeTrust.address}. Continue to deploy new CodeTrust?`,
    });
    if (!yes) {
      throw new Error("Deployment aborted");
    }
  }
  const codeTrustFactory = await ethers.getContractFactoryFromArtifact(
    CODE_TRUST_ARTIFACT,
    deployer
  );
  const codeTrust = await codeTrustFactory.deploy(GAS_OPT.max);
  const receipt = await codeTrust.deployTransaction.wait();
  if (!isAddress(codeTrust.address)) {
    throw new Error(`Contract instance address is invalid: ${codeTrust.address}`);
  }
  if (!isAddress(receipt.contractAddress)) {
    throw new Error(`Contract receipt address is invalid: ${receipt.contractAddress}`);
  }
  if (codeTrust.address != receipt.contractAddress) {
    throw new Error(
      `Contract addresses does not match: ${codeTrust.address}, ${receipt.contractAddress}`
    );
  }
  return {
    contractName: codeTrust.name,
    address: codeTrust.address,
    deployTxHash: receipt.transactionHash,
    deployTimestamp: (await ethers.provider.getBlock(receipt.blockHash)).timestamp,
    byteCodeHash: keccak256(CODE_TRUST_ARTIFACT.deployedBytecode),
  } as IRegularDeployment;
};

const initialize = async (
  codeTrustAddr: string,
  deployContractDeployer: boolean = true,
  systemSigner: Signer,
  existingContractRegistry?: string,
  existingContractDeployer?: string
) => {
  // Factories needed to deploy
  const contractRegistryFactory = ethers.getContractFactoryFromArtifact(
    CONTRACT_REGISTRY_ARTIFACT,
    systemSigner
  ) as Promise<ContractRegistry__factory>;
  const contractDeployerFactory = ethers.getContractFactoryFromArtifact(
    CONTRACT_DEPLOYER_ARTIFACT,
    systemSigner
  ) as Promise<ContractDeployer__factory>;
  // Contracts
  // -- needed for later
  const codeTrust = ethers.getContractAtFromArtifact(CODE_TRUST_ARTIFACT, codeTrustAddr);
  let contractRegistry: IContractRegistry;
  let contractDeployer: IContractDeployer | undefined;
  let registryReceipt, codeTrustReceipt: TransactionReceipt;
  let deployerReceipt: TransactionReceipt | undefined;
  // Deploy ContractRegistry
  if (existingContractRegistry) {
    // only create the contract registry instance
    contractRegistry = (await ethers.getContractAtFromArtifact(
      CONTRACT_REGISTRY_ARTIFACT,
      existingContractRegistry,
      systemSigner
    )) as IContractRegistry;
  } else {
    // deploy
    contractRegistry = await (
      await (
        await contractRegistryFactory
      ).deploy(codeTrustAddr, NAME_HEXSTRING_ZERO, 0, keccak256(REGISTRY_DEP_CODE), GAS_OPT.max)
    ).deployed();
  }
  // Deploy ContractDeployer
  if (existingContractDeployer) {
    // only create the contract deployer instance
    contractDeployer = (await ethers.getContractAtFromArtifact(
      CONTRACT_DEPLOYER_ARTIFACT,
      existingContractDeployer,
      systemSigner
    )) as IContractDeployer;
  } else if (deployContractDeployer) {
    // deploy
    contractDeployer = await (
      await (await contractDeployerFactory).deploy(contractRegistry.address, GAS_OPT.max)
    ).deployed();
  }
  codeTrustReceipt = await (await codeTrust).deployTransaction.wait();
  registryReceipt = await contractRegistry.deployTransaction.wait();
  deployerReceipt = contractDeployer ? await contractDeployer.deployTransaction.wait() : undefined;
  // Get all blocks
  const codeTrustBlock = ethers.provider.getBlock(codeTrustReceipt.blockHash);
  const registryBlock = ethers.provider.getBlock(registryReceipt.blockHash);
  const deployerBlock = deployerReceipt
    ? ethers.provider.getBlock(deployerReceipt.blockHash)
    : undefined;

  // Save ContractRegistry deploy information
};

const registerByName = async (contractName: TODO) => {};

const register = async (
  recordName: string,
  proxy: string,
  logic: string,
  version: string,
  logicCodeHash: BytesLike,
  admin: Signer,
  contractRegistry?: string | IContractRegistry
) => {
  const adminAddr = admin.getAddress();
  contractRegistry = (await createRegistryInstance(
    contractRegistry,
    ethers.provider
  )) as IContractRegistry; // TODO: remove "as"...
  const nameBytes = formatBytes32String(recordName);
  const versionNumber = await versionDotToNum(version);

  const receipt = await (
    await contractRegistry.register(
      nameBytes,
      proxy,
      logic,
      versionNumber,
      logicCodeHash,
      await adminAddr,
      GAS_OPT.max
    )
  ).wait();
  // TODO: throw exception

  return await getRecord(recordName, await adminAddr, version, contractRegistry);
};

const getRecord = async (
  recordName: string,
  admin: string,
  version?: string,
  contractRegistry?: string | IContractRegistry
) => {
  contractRegistry = (await createRegistryInstance(
    contractRegistry,
    ethers.provider
  )) as IContractRegistry; // TODO: remove "as"...
  const nameBytes = formatBytes32String(recordName);
  const versionNumber = version ? await versionDotToNum(version) : undefined;

  const result = await contractRegistry.getRecord(nameBytes, admin, versionNumber || 10000);
  if (!result.found) {
    throw new Error(
      `ERROR: contract ${recordName} not found in ContractRegistry ${contractRegistry.address} for admin ${admin}`
    );
  }
  return result.record;
};

export const versionNumToDot = async (versionNum: number) => {
  const versionString = versionNum.toString();
  const zeroPad = "000";
  const finalVersion = zeroPad.substring(0, 4 - versionString.length) + versionString;
  return `${finalVersion.substring(0, 2)}.${finalVersion.substring(2, 4)}`;
};

export const versionDotToNum = async (versionDot: string) => {
  return +(versionDot.substring(0, 2) + versionDot.substring(3, 5));
};
