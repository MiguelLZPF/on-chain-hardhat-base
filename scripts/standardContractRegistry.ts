import { CONTRACTS, GAS_OPT } from "configuration";
import { ADDR_ZERO, gNetwork, gProvider, getArtifact, getContractInstance } from "scripts/utils";
import { Signer, VoidSigner, PayableOverrides, Contract, ContractReceipt } from "ethers";
import {
  isAddress,
  keccak256,
  formatBytes32String,
  parseBytes32String,
  BytesLike,
  Interface,
} from "ethers/lib/utils";
import { IDecodedRecord } from "models/StandardContractRegistry";
import { deployCodeTrust } from "./decentralizedCodeTrust";
import { CodeTrust } from "node_modules/decentralized-code-trust/typechain-types";
import {
  ContractRegistry,
  ContractDeployer,
  IContractRegistry,
  IContractDeployer,
  IUpgradeableDeployer,
} from "node_modules/standard-contract-registry/typechain-types";
import { deploy, saveDeployment } from "scripts/deploy";
import { ContractName } from "models/Configuration";
import { ContractRecordStructOutput } from "standard-contract-registry/typechain-types/artifacts/contracts/interfaces/IContractRegistry";
import { IDeployReturn, IRegularDeployment, IUpgrDeployReturn } from "models/Deploy";
import { Ownable, ProxyAdmin, TransparentUpgradeableProxy } from "typechain-types";

export const MAX_VERSION = 9999;

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
    const result = await deploy("ContractRegistry", systemSigner, [codeTrust.address], undefined, {
      offChain: false,
      onChain: false,
    });
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
        {
          offChain: false,
          onChain: false,
        }
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
      contractName: codeTrustRecord.name as ContractName,
      address: codeTrustRecord.logic,
      byteCodeHash: codeTrustRecord.logicCodeHash,
      deployTimestamp: codeTrustRecord.timestamp,
      tag: "Miguel_LZPF",
    },
    {
      contractName: registryRecord.name as ContractName,
      address: registryRecord.logic,
      byteCodeHash: registryRecord.logicCodeHash,
      deployTimestamp: registryRecord.timestamp,
      tag: "Miguel_LZPF",
    },
    contractDeployer
      ? {
          contractName: deployerRecord?.name as ContractName,
          address: deployerRecord!.logic,
          byteCodeHash: deployerRecord!.logicCodeHash,
          deployTimestamp: deployerRecord!.timestamp,
          tag: "Miguel_LZPF",
        }
      : undefined,
  ];
  // Actual write operation happens here
  await saveDeployment(objectToSave[0]!),
    await saveDeployment(objectToSave[1]!),
    objectToSave[2] ? await saveDeployment(objectToSave[2]) : undefined;

  return objectToSave;
};

export const register = async (
  version: string,
  admin: Signer,
  contractName?: ContractName,
  recordName: string = CONTRACTS.get(contractName!)!.name,
  proxy: string = ADDR_ZERO,
  logic: string = CONTRACTS.get(contractName!)!.address.get(gNetwork.name!)!,
  logicCodeHash?: BytesLike,
  contractRegistry?: string | (IContractRegistry & Ownable)
) => {
  // check if admin is connected
  admin = admin.provider ? admin : admin.connect(gProvider);
  const adminAddr = admin.getAddress();
  contractRegistry = await getContractInstance<IContractRegistry & Ownable>(
    "ContractRegistry",
    admin,
    contractRegistry
  );
  const nameBytes = formatBytes32String(recordName);
  const versionNumber = await versionDotToNum(version);
  // Calculate the logicCodeHash if not given
  if (!logicCodeHash && !contractName) {
    throw new Error(`No logicCodeHash provided and no recordName to calculate it`);
  }
  logicCodeHash = logicCodeHash
    ? logicCodeHash
    : keccak256(getArtifact(contractName).deployedBytecode);

  let receipt: ContractReceipt | undefined;
  try {
    receipt = await (
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
  } catch (error) {
    throw new Error(`❌ 📄 In direct SC registering deployment in ContractRegistry. ${error}`);
  }

  if (!receipt || !receipt.transactionHash) {
    throw new Error("ERROR: Transaction not executed, no valid receipt found");
  }
  return await getRecord(recordName, await adminAddr, version, contractRegistry);
};

export const getRecords = async (
  admin?: string,
  contractRegistry?: string | (IContractRegistry & Ownable)
) => {
  contractRegistry = await getContractInstance<IContractRegistry & Ownable>(
    "ContractRegistry",
    typeof contractRegistry != "string" ? contractRegistry?.provider : undefined,
    contractRegistry
  );
  let latestRecordNames: string[];
  let systemAdmin: Promise<string> | undefined;
  if (admin) {
    const signer = new VoidSigner(admin, contractRegistry.provider);
    contractRegistry = contractRegistry.connect(signer);
    latestRecordNames = await contractRegistry.getMyRecords();
  } else {
    systemAdmin = contractRegistry.owner();
    latestRecordNames = await contractRegistry.getSystemRecords();
  }
  // Get all record results details in parallel
  let latestRecordsResult: Promise<
    [boolean, ContractRecordStructOutput] & { found: boolean; record: ContractRecordStructOutput }
  >[] = [];
  for (const recordName of latestRecordNames) {
    latestRecordsResult.push(
      contractRegistry.getRecord(recordName, (admin || (await systemAdmin))!, MAX_VERSION + 1)
    );
  }
  // Check if all founded
  for (const recordResult of await Promise.all(latestRecordsResult)) {
    if (!recordResult.found) {
      throw new Error(`Cannot find record: '${(await decodeRecord(recordResult.record)).name}'`);
    }
  }
  // Decode all records in parallel for human readability
  let latestRecords: Promise<IDecodedRecord>[] = [];
  for (const recordResult of await Promise.all(latestRecordsResult)) {
    latestRecords.push(decodeRecord(recordResult.record));
  }
  return await Promise.all(latestRecords);
};

export const getRecord = async (
  recordName: string,
  admin: string,
  version?: string,
  contractRegistry?: string | (IContractRegistry & Ownable)
) => {
  contractRegistry = await getContractInstance<IContractRegistry & Ownable>(
    "ContractRegistry",
    typeof contractRegistry != "string" ? contractRegistry?.provider : undefined,
    contractRegistry
  );
  const nameBytes = formatBytes32String(recordName);
  const versionNumber = version ? await versionDotToNum(version) : undefined;

  const result = await contractRegistry.getRecord(
    nameBytes,
    admin,
    versionNumber || MAX_VERSION + 1
  );
  if (!result.found) {
    throw new Error(
      `ERROR: contract ${recordName} not found in ContractRegistry ${contractRegistry.address} for admin ${admin}`
    );
  }
  return await decodeRecord(result.record);
};

const decodeRecord = async (record: ContractRecordStructOutput) => {
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

export const deployWithContractDeployer = async (
  contractName: ContractName,
  recordName: string,
  deployer: Signer,
  args: unknown[] = [],
  overrides?: PayableOverrides,
  version?: string,
  contractRegistry?: string | (IContractRegistry & Ownable),
  contractDeployer?: string | IContractDeployer
): Promise<IDeployReturn> => {
  // check if deployer is connected to the provider
  deployer = deployer.provider ? deployer : deployer.connect(gProvider);
  // get the artifact of the contract name
  const artifact = getArtifact(contractName);
  // get the SCR Contract instances
  contractRegistry = await getContractInstance<IContractRegistry & Ownable>(
    "ContractRegistry",
    deployer,
    contractRegistry
  );
  contractDeployer =
    typeof contractDeployer === "string" || !contractDeployer
      ? await getContractInstance<IContractDeployer>("ContractDeployer", deployer, contractDeployer)
      : contractDeployer;
  //* Actual deployment
  const nameBytes = formatBytes32String(recordName);
  const versionNumber = await versionDotToNum(version || "01.00");
  // encode contract deploy parameters | arguments
  const encodedArgs = new Interface(artifact.abi).encodeDeploy(args);
  // deploy
  const receipt = await (
    await contractDeployer.deployContract(
      contractRegistry.address || ADDR_ZERO,
      artifact.bytecode,
      encodedArgs,
      new Uint8Array(32),
      nameBytes,
      versionNumber,
      overrides || { ...GAS_OPT.max }
    )
  ).wait();
  if (!receipt) {
    throw new Error(`Error in contract deployment. Receipt undefined.`);
  }
  const newRecord = await getRecord(
    recordName,
    await deployer.getAddress(),
    version,
    contractRegistry
  );
  console.log(`
    Regular contract deployed:
      - Address: ${newRecord.logic}
      - Arguments: ${args}`);
  return {
    record: newRecord,
    contractInstance: await getContractInstance(contractName, deployer, newRecord.logic),
  };
};

export const deployWithUpgrDeployer = async (
  contractName: ContractName,
  recordName: string,
  deployer: Signer,
  args: unknown[] = [],
  overrides?: PayableOverrides,
  version?: string,
  contractRegistry?: string | (IContractRegistry & Ownable),
  upgradeableDeployer?: string | (IUpgradeableDeployer & ProxyAdmin)
): Promise<IUpgrDeployReturn> => {
  // check if deployer is connected to the provider
  deployer = deployer.provider ? deployer : deployer.connect(gProvider);
  // get the artifact of the contract name
  const artifact = getArtifact(contractName);
  // get the SCR Contract instances
  contractRegistry = await getContractInstance<IContractRegistry & Ownable>(
    "ContractRegistry",
    deployer,
    contractRegistry
  );
  upgradeableDeployer = await getContractInstance<IUpgradeableDeployer & ProxyAdmin>(
    "UpgradeableDeployer",
    deployer,
    upgradeableDeployer
  );
  //* Actual deployment
  // encode contract deploy parameters | arguments
  const encodedArgs = new Interface(artifact.abi).encodeDeploy(args);
  // deploy
  const receipt = await (
    await upgradeableDeployer.deployContract(
      contractRegistry.address || ADDR_ZERO,
      artifact.bytecode,
      encodedArgs,
      new Uint8Array(32),
      recordName,
      version || "01.00",
      overrides || { ...GAS_OPT.max }
    )
  ).wait();
  if (!receipt) {
    throw new Error(`Error in contract deployment. Receipt undefined.`);
  }
  const newRecord = await getRecord(
    recordName,
    await deployer.getAddress(),
    version,
    contractRegistry
  );
  console.log(`
    Upgradeable contract deployed:
      - Address: ${newRecord.logic}
      - Arguments: ${args}`);
  return {
    record: newRecord,
    proxyAdminInstance: upgradeableDeployer as ProxyAdmin,
    tupInstance: await getContractInstance<TransparentUpgradeableProxy>(
      "TUP",
      deployer,
      newRecord.proxy!
    ),
    logicInstance: await getContractInstance<Contract>(contractName, deployer, newRecord.logic!),
    contractInstance: await getContractInstance<Contract>(contractName, deployer, newRecord.proxy!),
  };
};

// UTILITY FUNCTIONS
export const versionNumToDot = async (versionNum: number) => {
  const versionString = versionNum.toString();
  const zeroPad = "000";
  const finalVersion = zeroPad.substring(0, 4 - versionString.length) + versionString;
  return `${finalVersion.substring(0, 2)}.${finalVersion.substring(2, 4)}`;
};

export const versionDotToNum = async (versionDot: string) => {
  return +(versionDot.substring(0, 2) + versionDot.substring(3, 5));
};
