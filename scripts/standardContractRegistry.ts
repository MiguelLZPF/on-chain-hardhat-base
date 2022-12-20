import { CONTRACT, DEPLOY, GAS_OPT } from "configuration";
import { ghre } from "scripts/utils";
import * as fs from "async-file";
import { Signer, ContractFactory, Contract } from "ethers";
import { isAddress, keccak256, formatBytes32String, BytesLike } from "ethers/lib/utils";
import { TransactionReceipt, JsonRpcProvider, Provider } from "@ethersproject/providers";
import yesno from "yesno";
import { IRegularDeployment } from "models/Deploy";
// Artifacts
import * as CODE_TRUST_ARTIFACT from "node_modules/decentralized-code-trust/artifacts/contracts/CodeTrust.sol/CodeTrust.json";
import * as CONTRACT_REGISTRY_ARTIFACT from "node_modules/standard-contract-registry/artifacts/contracts/ContractRegistry.sol/ContractRegistry.json";
import * as CONTRACT_DEPLOYER_ARTIFACT from "node_modules/standard-contract-registry/artifacts/contracts/ContractDeployer.sol/ContractDeployer.json";
import { CodeTrust__factory } from "node_modules/decentralized-code-trust/typechain-types";
import {
  ContractDeployer__factory,
  ContractRegistry__factory,
  IContractDeployer,
  IContractRegistry,
} from "typechain-types";

const NAME_HEXSTRING_ZERO = formatBytes32String("");
// Deploy contract code
const CODE_TRUST_DEP_CODE_HASH = keccak256(CODE_TRUST_ARTIFACT.deployedBytecode);
const REGISTRY_DEP_CODE_HASH = keccak256(CONTRACT_REGISTRY_ARTIFACT.deployedBytecode);
const DEPLOYER_DEP_CODE_HASH = keccak256(CONTRACT_DEPLOYER_ARTIFACT.deployedBytecode);

export const deployCodeTrust = async (deployer: Signer) => {
  const provider = deployer.provider || ghre.ethers.provider;
  if (CONTRACT.codeTrust.address) {
    const yes = await yesno({
      question: `Contract ${CONTRACT.codeTrust.name} has an address set to ${CONTRACT.codeTrust.address}. Continue to deploy new CodeTrust?`,
    });
    if (!yes) {
      throw new Error("Deployment aborted");
    }
  }
  const codeTrustFactory = new ContractFactory(
    CODE_TRUST_ARTIFACT.abi,
    CODE_TRUST_ARTIFACT.bytecode,
    deployer
  ) as CodeTrust__factory;
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
    contractName: CONTRACT.codeTrust.name,
    address: codeTrust.address,
    deployTxHash: receipt.transactionHash,
    deployTimestamp: (await provider.getBlock(receipt.blockHash)).timestamp,
    byteCodeHash: keccak256(CODE_TRUST_ARTIFACT.deployedBytecode),
  } as IRegularDeployment;
};

export const initialize = async (
  codeTrustAddr: string,
  deployContractDeployer: boolean = true,
  systemSigner: Signer,
  existingContractRegistry?: string,
  existingContractDeployer?: string
) => {
  const provider = systemSigner.provider || ghre.ethers.provider;
  // Factories needed to deploy
  const contractRegistryFactory = new ContractFactory(
    CONTRACT_REGISTRY_ARTIFACT.abi,
    CONTRACT_REGISTRY_ARTIFACT.bytecode,
    systemSigner
  ) as ContractRegistry__factory;
  const contractDeployerFactory = new ContractFactory(
    CONTRACT_DEPLOYER_ARTIFACT.abi,
    CONTRACT_DEPLOYER_ARTIFACT.bytecode,
    systemSigner
  ) as ContractDeployer__factory;
  // Contracts
  // -- needed for later
  const codeTrust = new Contract(codeTrustAddr, CODE_TRUST_ARTIFACT.abi, systemSigner);
  let contractRegistry: IContractRegistry;
  let contractDeployer: IContractDeployer | undefined;
  let registryReceipt, codeTrustReceipt: TransactionReceipt;
  let deployerReceipt: TransactionReceipt | undefined;
  // Deploy ContractRegistry
  if (existingContractRegistry) {
    // only create the contract registry instance
    contractRegistry = new Contract(
      existingContractRegistry,
      CONTRACT_REGISTRY_ARTIFACT.abi,
      systemSigner
    ) as IContractRegistry;
  } else {
    // deploy
    contractRegistry = await (
      await contractRegistryFactory.deploy(
        codeTrustAddr,
        NAME_HEXSTRING_ZERO,
        await versionDotToNum("01.00"),
        keccak256(REGISTRY_DEP_CODE_HASH),
        GAS_OPT.max
      )
    ).deployed();
  }
  // Deploy ContractDeployer
  if (existingContractDeployer) {
    // only create the contract deployer instance
    contractDeployer = new Contract(
      existingContractDeployer,
      CONTRACT_DEPLOYER_ARTIFACT.abi,
      systemSigner
    ) as IContractDeployer;
  } else if (deployContractDeployer) {
    // deploy
    contractDeployer = await (
      await contractDeployerFactory.deploy(contractRegistry.address, GAS_OPT.max)
    ).deployed();
  }
  // codeTrustReceipt = await codeTrust.deployTransaction.wait();
  registryReceipt = await contractRegistry.deployTransaction.wait();
  deployerReceipt = contractDeployer ? await contractDeployer.deployTransaction.wait() : undefined;
  // Get all blocks
  // const codeTrustBlock = provider.getBlock(codeTrustReceipt.blockHash);
  // const registryBlock = provider.getBlock(registryReceipt.blockHash);
  // const deployerBlock = deployerReceipt ? provider.getBlock(deployerReceipt.blockHash) : undefined;
  // Get deployed code for each contract
  const codeTrustDepCode = provider.getCode(codeTrust.address);
  const registryDepCode = provider.getCode(contractRegistry.address);
  const deployerDepCode = contractDeployer ? provider.getCode(contractDeployer.address) : undefined;
  // Get hash of the deployed code
  const codeTrustDepCodeHash = keccak256(await codeTrustDepCode);
  const registryDepCodeHash = keccak256(await registryDepCode);
  const deployerDepCodeHash = deployerDepCode ? keccak256(await deployerDepCode) : undefined;
  // Check that is the same code
  // console.log(codeTrustDepCodeHash, CODE_TRUST_DEP_CODE_HASH);
  // console.log(registryDepCodeHash, REGISTRY_DEP_CODE_HASH);
  // console.log(deployerDepCodeHash, DEPLOYER_DEP_CODE_HASH);
  if (codeTrustDepCodeHash != CODE_TRUST_DEP_CODE_HASH) {
    console.warn(`WARNING: deployed code hash mismatch ${CONTRACT.codeTrust.name}`);
  }
  if (registryDepCodeHash != REGISTRY_DEP_CODE_HASH) {
    console.warn(`WARNING: deployed code hash mismatch ${CONTRACT.contractRegistry.name}`);
  }
  if (deployerDepCodeHash && deployerDepCodeHash != DEPLOYER_DEP_CODE_HASH) {
    console.warn(`WARNING: deployed code hash mismatch ${CONTRACT.contractDeployer.name}`);
  }
  // Register the contracts
  const registryRecord = getRecord(
    CONTRACT.contractRegistry.name,
    await systemSigner.getAddress(),
    undefined,
    contractRegistry
  );
  const codeTrustRecord = register(
    CONTRACT.codeTrust.name,
    codeTrust.address,
    codeTrust.address,
    "01.00",
    codeTrustDepCodeHash,
    systemSigner,
    contractRegistry
  );
  console.log(await codeTrustRecord, await registryRecord);
  const deployerRecord = contractDeployer
    ? register(
        CONTRACT.contractDeployer.name,
        contractDeployer.address,
        contractDeployer.address,
        "01.00",
        deployerDepCodeHash!,
        systemSigner,
        contractRegistry
      )
    : undefined;
    // Check deployments and registrations
  if (!(await codeTrustRecord) || !(await codeTrustRecord).name) {
    throw new Error(`ERROR: bad ${CONTRACT.codeTrust.name} record`);
  }
  if (!(await registryRecord) || !(await registryRecord).name) {
    throw new Error(`ERROR: bad ${CONTRACT.contractRegistry.name} record`);
  }
  if (contractDeployer && (!(await deployerRecord) || !(await deployerRecord)!.name)) {
    throw new Error(`ERROR: bad ${CONTRACT.contractDeployer.name} record`);
  }
  
  // Save ContractRegistry deploy information
  const objectToSave = {
    codeTrust: await codeTrustRecord,
    contractRegistry: await registryRecord,
    contractDeployer: await deployerRecord,
  };
  await fs.writeFile(DEPLOY.deploymentsPath, JSON.stringify(objectToSave));
  return objectToSave;
};

const registerByName = async (contractName: any /*TODO*/) => {};

const register = async (
  recordName: string,
  proxy: string,
  logic: string,
  version: string,
  logicCodeHash: BytesLike,
  admin: Signer,
  contractRegistry?: string | IContractRegistry
) => {
  const provider = admin.provider || ghre.ethers.provider;
  const adminAddr = admin.getAddress();
  contractRegistry = await createRegistryInstance(contractRegistry, admin);
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
  if (!receipt || !receipt.transactionHash) {
    throw new Error("ERROR: Transaction not executed, no valid receipt found");
  }
  return await getRecord(recordName, await adminAddr, version, contractRegistry);
};

const getRecord = async (
  recordName: string,
  admin: string,
  version?: string,
  contractRegistry?: string | IContractRegistry
) => {
  contractRegistry = await createRegistryInstance(
    contractRegistry,
    typeof contractRegistry != "string" ? contractRegistry?.provider : undefined
  );
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

// UTILITY FUNCTIONS

const createRegistryInstance = async (
  registry?: IContractRegistry | string,
  signerOrProvider: Signer | Provider | JsonRpcProvider = ghre.ethers.provider
) => {
  if (registry && typeof registry == "string") {
    // we have the registry address
    registry = new Contract(
      registry,
      CONTRACT_REGISTRY_ARTIFACT.abi,
      signerOrProvider
    ) as IContractRegistry;
  } else if (registry) {
    // we have the registry instance
    registry = (registry as IContractRegistry).connect(signerOrProvider);
  } else {
    // no registry, use the deployment file
    if (!(await fs.exists(DEPLOY.deploymentsPath))) {
      throw new Error(
        `No ContractRegistry deployment file found. An initialization step is needed.`
      );
    }
    const registryDeployment = JSON.parse(await fs.readFile(DEPLOY.deploymentsPath));

    registry = new Contract(
      registryDeployment.contractRegistry.proxy,
      CONTRACT_REGISTRY_ARTIFACT.abi,
      signerOrProvider
    ) as IContractRegistry;
  }
  return registry;
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