import { CONTRACTS, DEPLOY, GAS_OPT } from "configuration";
import { gNetwork, gProvider, getArtifact, getContractInstance, ghre } from "scripts/utils";
import { Signer, Contract } from "ethers";
import {
  isAddress,
  keccak256,
  formatBytes32String,
  parseBytes32String,
  BytesLike,
} from "ethers/lib/utils";
import { JsonRpcProvider, Provider } from "@ethersproject/providers";
import { IDecodedRecord } from "models/StandardContractRegistry";
import { deployCodeTrust } from "./decentralizedCodeTrust";
import { CodeTrust } from "node_modules/decentralized-code-trust/typechain-types";
import {
  ContractRegistry,
  ContractDeployer,
  IContractRegistry,
} from "node_modules/standard-contract-registry/typechain-types";
import { deploy, saveDeployment } from "scripts/deploy";
import { existsSync, readFileSync } from "fs";
import { ContractName } from "models/Configuration";
import { ContractRecordStructOutput } from "standard-contract-registry/typechain-types/artifacts/contracts/interfaces/IContractRegistry";
import { IRegularDeployment } from "models/Deploy";

export const initialize = async (
  systemSigner: Signer,
  deployContractDeployer: boolean = true,
  existingCodeTrust?: string,
  existingContractRegistry?: string,
  existingContractDeployer?: string
) => {
  // check if systemSigner is connected
  systemSigner = systemSigner.provider ? systemSigner : systemSigner.connect(gProvider);
  //* Get instance or deploy contracts
  let codeTrust: CodeTrust;
  let contractDeployer: ContractDeployer | undefined;
  let contractRegistry: ContractRegistry;
  if (existingCodeTrust && isAddress(existingCodeTrust)) {
    codeTrust = await getContractInstance<CodeTrust>("CodeTrust", systemSigner, existingCodeTrust);
  } else {
    const result = await deployCodeTrust(systemSigner);
    codeTrust = result.contractInstance;
  }
  if (existingContractRegistry && isAddress(existingContractRegistry)) {
    contractRegistry = await getContractInstance<ContractRegistry>(
      "ContractRegistry",
      systemSigner,
      existingCodeTrust
    );
  } else {
    const result = await deploy(
      "ContractRegistry",
      systemSigner,
      [codeTrust.address],
      undefined,
      undefined,
      false
    );
    contractRegistry = result.contractInstance as ContractRegistry;
  }
  if (deployContractDeployer) {
    if (existingContractDeployer && isAddress(existingContractDeployer)) {
      contractDeployer = await getContractInstance<ContractDeployer>(
        "ContractDeployer",
        systemSigner,
        existingCodeTrust
      );
    } else {
      const result = await deploy(
        "ContractDeployer",
        systemSigner,
        [contractRegistry.address],
        undefined,
        undefined,
        false
      );
      contractDeployer = result.contractInstance as ContractDeployer;
    }
  }
  // Register the contracts
  const codeTrustRecord = await register(
    "01.00",
    systemSigner,
    "CodeTrust",
    undefined,
    codeTrust.address,
    codeTrust.address,
    undefined,
    contractRegistry
  );
  const registryRecord = await register(
    "01.00",
    systemSigner,
    "ContractRegistry",
    undefined,
    contractRegistry.address,
    contractRegistry.address,
    undefined,
    contractRegistry
  );
  const deployerRecord = contractDeployer
    ? await register(
        "01.00",
        systemSigner,
        "ContractDeployer",
        undefined,
        contractDeployer.address,
        contractDeployer.address,
        undefined,
        contractRegistry
      )
    : undefined;
  // Check deployments and registrations
  if (!codeTrustRecord || !codeTrustRecord.name) {
    throw new Error(`ERROR: bad ${CONTRACTS.get("CodeTrust")!.name} record`);
  }
  if (!registryRecord || !registryRecord.name) {
    throw new Error(`ERROR: bad ${CONTRACTS.get("ContractRegistry")!.name} record`);
  }
  if (contractDeployer && (!deployerRecord || !deployerRecord!.name)) {
    throw new Error(`ERROR: bad ${CONTRACTS.get("ContractDeployer")!.name} record`);
  }

  // Save ContractRegistry deploy information
  const objectToSave: Array<IRegularDeployment | undefined> = [
    {
      contractName: CONTRACTS.get("CodeTrust")?.name!,
      address: codeTrustRecord.logic,
      byteCodeHash: codeTrustRecord.logicCodeHash,
      deployTimestamp: new Date(codeTrustRecord.timestamp.toNumber() * 1000),
      tag: "CodeTrust_Test",
    },
    {
      contractName: CONTRACTS.get("ContractRegistry")?.name!,
      address: registryRecord.logic,
      byteCodeHash: registryRecord.logicCodeHash,
      deployTimestamp: new Date(registryRecord.timestamp.toNumber() * 1000),
      tag: "ContractRegistry_Test",
    },
    contractDeployer
      ? {
          contractName: CONTRACTS.get("ContractDeployer")?.name!,
          address: deployerRecord!.logic,
          byteCodeHash: deployerRecord!.logicCodeHash,
          deployTimestamp: new Date(deployerRecord!.timestamp.toNumber() * 1000),
          tag: "ContractDeployer_Test",
        }
      : undefined,
  ];
  // Actual write operation happens here
  await saveDeployment(objectToSave[0]!),
  await saveDeployment(objectToSave[1]!),
  objectToSave[2] ? await saveDeployment(objectToSave[2]) : undefined;
  
  return objectToSave;
};

const register = async (
  version: string,
  admin: Signer,
  contractName?: ContractName,
  recordName: string = CONTRACTS.get(contractName!)!.name,
  proxy: string = CONTRACTS.get(contractName!)!.address.get(gNetwork.name!)!,
  logic: string = CONTRACTS.get(contractName!)!.address.get(gNetwork.name!)!,
  logicCodeHash?: BytesLike,
  contractRegistry?: string | IContractRegistry
) => {
  // check if admin is connected
  admin = admin.provider ? admin : admin.connect(gProvider);
  const adminAddr = admin.getAddress();
  contractRegistry = await createRegistryInstance(contractRegistry, admin);
  const nameBytes = formatBytes32String(recordName);
  const versionNumber = await versionDotToNum(version);
  // Calculate the logicCodeHash if not given
  if (!logicCodeHash && !contractName) {
    throw new Error(`No logicCodeHash provided and no recordName to calculate it`);
  }
  logicCodeHash = logicCodeHash
    ? logicCodeHash
    : keccak256(getArtifact(contractName).deployedBytecode);

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
  return { ...result.record };
};

const decodedRecord = async (record: ContractRecordStructOutput) => {
  return {
    name: parseBytes32String(record.name),
    proxy: record.proxy == record.logic ? undefined : record.proxy,
    logic: record.logic,
    admin: record.admin,
    version: await versionNumToDot(record.version),
    logicCodeHash: record.logicCodeHash,
    extraData: record.extraData || record.extraData != "0x" ? record.extraData : undefined,
    timestamp: new Date(record.timestamp.mul(1000).toNumber()),
  } as IDecodedRecord;
};

// UTILITY FUNCTIONS

const createRegistryInstance = async (
  registry?: IContractRegistry | string,
  signerOrProvider: Signer | Provider | JsonRpcProvider = ghre.ethers.provider
) => {
  const contractRegistryArtifact = getArtifact("ContractRegistry");
  if (registry && typeof registry == "string") {
    // we have the registry address
    registry = new Contract(
      registry,
      contractRegistryArtifact.abi,
      signerOrProvider
    ) as IContractRegistry;
  } else if (registry) {
    // we have the registry instance
    registry = (registry as IContractRegistry).connect(signerOrProvider);
  } else {
    // no registry, use the deployment file
    if (!existsSync(DEPLOY.deploymentsPath)) {
      throw new Error(
        `No ContractRegistry deployment file found. An initialization step is needed.`
      );
    }
    const registryDeployment = JSON.parse(readFileSync(DEPLOY.deploymentsPath, "utf-8"));

    registry = new Contract(
      registryDeployment.contractRegistry.proxy,
      contractRegistryArtifact.abi,
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
