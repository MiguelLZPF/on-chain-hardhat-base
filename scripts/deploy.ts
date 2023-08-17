import { BLOCKCHAIN, CONTRACTS, DEPLOY, GAS_OPT } from "configuration";
import {
  chainIdToNetwork,
  getArtifact,
  getContractInstance,
  ghre,
  gNetwork,
  gProvider,
} from "scripts/utils";
import { Artifact, HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract, ContractReceipt, Signer, PayableOverrides, ContractFactory } from "ethers";
import { isAddress, keccak256 } from "ethers/lib/utils";
import {
  IDeployReturn,
  INetworkDeployment,
  IRegularDeployment,
  IStorageOptions,
  IUpgradeDeployment,
  IUpgradeReturn,
  IUpgrDeployReturn,
} from "models/Deploy";
import yesno from "yesno";
import { PromiseOrValue } from "typechain-types/common";
import { Ownable, ProxyAdmin, TransparentUpgradeableProxy } from "typechain-types";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { ContractName } from "models/Configuration";
import { getRecord, register, update } from "./standardContractRegistry";
import { IDecodedRecord } from "models/StandardContractRegistry";
import { IContractRegistry } from "standard-contract-registry/typechain-types";

const PROXY_ADMIN_ARTIFACT = JSON.parse(
  readFileSync(CONTRACTS.get("ProxyAdmin")!.artifact, "utf-8")
) as Artifact;
const PROXY_ADMIN_CODEHASH = keccak256(PROXY_ADMIN_ARTIFACT.deployedBytecode);

/**
 * Performs a regular deployment and updates the deployment information in deployments JSON file
 * @param contractName name of the contract to be deployed
 * @param deployer signer used to sign deploy transacciation
 * @param args arguments to use in the constructor
 * @param txValue contract creation transaccion value
 */
export const deploy = async (
  contractName: ContractName,
  deployer: Signer,
  args: unknown[] = [],
  overrides?: PayableOverrides,
  storageOpt: IStorageOptions = {
    onChain: true,
    offChain: false,
    tag: undefined,
    scr: {},
  }
): Promise<IDeployReturn> => {
  // check if deployer is connected to the provider
  deployer = deployer.provider ? deployer : deployer.connect(gProvider);
  const deployerAddr = deployer.getAddress();
  // (async) get Contract Registry instance
  const contractRegistry = getContractInstance<IContractRegistry & Ownable>(
    "ContractRegistry",
    deployer
  );
  // get the artifact of the contract name
  const artifact = getArtifact(contractName);
  // create factory instance and deploy
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  // actual deployment
  const contract = await (
    await factory.deploy(...args, overrides ? overrides : { ...GAS_OPT.max })
  ).deployed();
  const receipt = await contract.deployTransaction.wait();
  // console.log(`
  //   Regular contract deployed:
  //     - Address: ${contract.address}
  //     - Arguments: ${args}`);
  //* Store contract deployment information
  const byteCodeHash = keccak256(await deployer.provider!.getCode(contract.address));
  const deployment: IRegularDeployment = {
    address: contract.address,
    contractName: contractName,
    deployTimestamp: await getContractTimestamp(contract, receipt.transactionHash),
    deployTxHash: receipt.transactionHash,
    byteCodeHash: byteCodeHash,
    tag: storageOpt.tag,
  };
  // if off chain file store
  storageOpt.offChain ? await saveDeployment(deployment) : undefined;
  // if on chain record store
  let newRecord, actualRecord: IDecodedRecord | undefined;
  // flag to know if contract record has been updated
  let updated = false;
  if (storageOpt.onChain) {
    // check default values
    storageOpt.scr = storageOpt.scr || {
      version: "01.00",
      recordName: contractName,
      contractRegistry: (await contractRegistry).address,
    };
    storageOpt.scr.version = storageOpt.scr.version || "01.00";
    storageOpt.scr.recordName = storageOpt.scr.recordName || contractName;
    storageOpt.scr.contractRegistry =
      storageOpt.scr.contractRegistry || (await contractRegistry).address;
    try {
      actualRecord = await getRecord(
        storageOpt.scr.recordName,
        await deployerAddr,
        undefined,
        storageOpt.scr.contractRegistry
      );
    } catch (error) {
      console.error(
        `❌ Error retreiving record deployment before changes in ContractRegistry. ${error}`
      );
    }
    if (actualRecord && actualRecord.version < storageOpt.scr.version) {
      // update if already registered
      try {
        await update(
          storageOpt.scr.version,
          deployer,
          contractName,
          storageOpt.scr.recordName,
          undefined,
          contract.address,
          undefined,
          byteCodeHash,
          await contractRegistry
        );
        updated = true;
      } catch (error) {
        throw new Error(`❌ Registering deployment in ContractRegistry. ${error}`);
      }
    } else {
      // register otherwise
      try {
        await register(
          storageOpt.scr.version,
          deployer,
          contractName,
          storageOpt.scr.recordName,
          undefined,
          contract.address,
          byteCodeHash,
          await contractRegistry
        );
      } catch (error) {
        throw new Error(`❌ Registering deployment in ContractRegistry. ${error}`);
      }
    }

    try {
      newRecord = await getRecord(
        storageOpt.scr.recordName,
        await deployerAddr,
        storageOpt.scr.version,
        storageOpt.scr.contractRegistry
      );
    } catch (error) {
      console.error(`❌ Error retreiving record deployment in ContractRegistry. ${error}`);
    }
  }
  return {
    deployment: storageOpt.offChain ? deployment : undefined,
    record: storageOpt.onChain ? newRecord : undefined,
    recordUpdated: updated,
    contractInstance: contract,
  };
};

/**
 * Performs an upgradeable deployment and updates the deployment information in deployments JSON file
 * @param contractName name of the contract to be deployed
 * @param deployer signer used to sign deploy transacciation
 * @param args arguments to use in the initializer
 * @param txValue contract creation transaccion value
 * @param proxyAdmin (optional ? PROXY_ADMIN_ADDRESS) custom proxy admin address
 */
export const deployUpgradeable = async (
  contractName: ContractName,
  deployer: Signer,
  args: unknown[] = [],
  overrides?: PayableOverrides,
  proxyAdmin: string | ProxyAdmin | undefined = CONTRACTS.get("ProxyAdmin")?.address.get(
    gNetwork.name
  ),
  initialize: boolean = false,
  storageOpt: IStorageOptions = {
    onChain: true,
    offChain: false,
    tag: undefined,
    scr: { recordName: contractName, version: "01.00" },
  }
): Promise<IUpgrDeployReturn> => {
  // check if deployer is connected to the provider
  deployer = deployer.provider ? deployer : deployer.connect(gProvider);
  //* Proxy Admin
  // save or update Proxy Admin in deployments
  let adminDeployment: Promise<IRegularDeployment | undefined> | IRegularDeployment | undefined;
  if (proxyAdmin && typeof proxyAdmin == "string" && isAddress(proxyAdmin)) {
    proxyAdmin = await getContractInstance<ProxyAdmin>("ProxyAdmin", deployer, proxyAdmin);
  } else if (proxyAdmin && typeof proxyAdmin == "string") {
    throw new Error("String provided as Proxy Admin's address is not an address");
  } else if (!proxyAdmin) {
    const firstDeployedAdmin = await getProxyAdminDeployment();
    if (firstDeployedAdmin && firstDeployedAdmin.address) {
      // use the first existant proxy admin deployment
      proxyAdmin = await getContractInstance<ProxyAdmin>(
        "ProxyAdmin",
        deployer,
        firstDeployedAdmin.address
      );
    } else {
      // deploy new Proxy Admin
      const ok = await yesno({
        question: "No ProxyAdmin provided. Do you want to deploy a new Proxy Admin?",
      });
      if (!ok) {
        throw new Error("Deployment aborted");
      }
      const deployResult = await deploy("ProxyAdmin", deployer, undefined, undefined, {
        offChain: false,
        onChain: false,
      });
      proxyAdmin = deployResult.contractInstance as ProxyAdmin;
      adminDeployment = deployResult.deployment;
    }
  } else {
    // proxy admin given as Contract
    proxyAdmin = proxyAdmin as ProxyAdmin;
  }
  // check if proxy admin is a ProxyAdmin Contract
  try {
    const proxyAdminCode = await deployer.provider!.getCode(proxyAdmin.address);
    if (keccak256(proxyAdminCode) != PROXY_ADMIN_CODEHASH) {
      throw new Error(`ERROR: ProxyAdmin(${proxyAdmin.address}) is not a ProxyAdmin Contract`);
    }
  } catch (error) {
    throw new Error(`ERROR: ProxyAdmin(${proxyAdmin.address}) is not a ProxyAdmin Contract`);
  }
  // verify if Proxy Admin deployment is already definer or get one from deployments.json file
  adminDeployment = (await adminDeployment)
    ? adminDeployment
    : getProxyAdminDeployment(undefined, proxyAdmin.address);
  //* Actual contracts
  // deploy logic contract
  const deployResult = await deploy(contractName, deployer, undefined, GAS_OPT.max, {
    offChain: false,
    onChain: false,
  });
  const logic = deployResult.contractInstance;
  const timestamp = getContractTimestamp(logic);
  if (!logic || !logic.address) {
    throw new Error("Logic|Implementation not deployed properly");
  }
  // console.log(`Logic contract deployed at: ${logic.address}`);
  // encode initialize function params for TUP
  let initData: string;
  if (initialize) {
    initData = logic.interface.encodeFunctionData("initialize", [...args]);
  } else {
    initData = logic.interface._encodeParams([], []);
  }
  // console.log(`Initialize data to be used: ${initData}`);
  //* TUP - Transparent Upgradeable Proxy
  const tupDeployResult = await deploy(
    "TUP",
    deployer,
    [logic.address, proxyAdmin.address, initData],
    overrides,
    {
      offChain: false,
      onChain: false,
    }
  );
  const tuProxy = tupDeployResult.contractInstance as TransparentUpgradeableProxy;
  if (!tuProxy || !tuProxy.address) {
    throw new Error("Proxy|Storage not deployed properly");
  }
  // console.log(`
  //   Upgradeable contract deployed:
  //     - Proxy Admin: ${proxyAdmin.address},
  //     - Proxy: ${tuProxy.address},
  //     - Logic: ${logic.address}
  //     - Arguments: ${args}
  // `);

  //* Store contract deployment information
  const byteCodeHash = keccak256(await deployer.provider!.getCode(logic.address));
  const deployment: IUpgradeDeployment = {
    admin: proxyAdmin.address,
    proxy: tuProxy.address,
    logic: logic.address,
    contractName: contractName,
    deployTimestamp: await timestamp,
    proxyDeployTxHash: tupDeployResult.deployment!.deployTxHash,
    logicDeployTxHash: logic.deployTransaction.hash,
    byteCodeHash: byteCodeHash,
    tag: storageOpt.tag,
  };
  adminDeployment = (await adminDeployment)
    ? await adminDeployment
    : {
        address: proxyAdmin.address,
        contractName: CONTRACTS.get("ProxyAdmin")!.name,
        byteCodeHash: PROXY_ADMIN_CODEHASH,
      };
  // if off chain file store
  storageOpt.offChain ? await saveDeployment(deployment, adminDeployment) : undefined;
  // if on chain record store
  let newRecord: IDecodedRecord | undefined;
  if (storageOpt.onChain) {
    try {
      await register(
        storageOpt.scr!.version!,
        deployer,
        contractName,
        storageOpt.scr!.recordName,
        tuProxy.address,
        logic.address,
        byteCodeHash
      );
    } catch (error) {
      console.error(`Error registering deployment in ContractRegistry. ${error}`);
    }
    try {
      newRecord = await getRecord(
        storageOpt.scr!.recordName!,
        await deployer.getAddress(),
        storageOpt.scr!.version,
        storageOpt.scr!.contractRegistry
      );
    } catch (error) {
      console.error(`Error retreiving record deployment in ContractRegistry. ${error}`);
    }
  }
  return {
    deployment: storageOpt.offChain ? deployment : undefined,
    record: storageOpt.onChain ? newRecord : undefined,
    adminDeployment: adminDeployment,
    proxyAdminInstance: proxyAdmin,
    tupInstance: tuProxy,
    logicInstance: logic,
    contractInstance: await getContractInstance<Contract>(contractName, deployer, tuProxy.address),
  };
};

/**
 * Upgrades the logic Contract of an upgradeable deployment and updates the deployment information in deployments JSON file
 * @param contractName name of the contract to be upgraded (main use: get factory)
 * @param deployer signer used to sign transacciations
 * @param args arguments to use in the initializer
 * @param proxy (optional) [undefined] address to identifie multiple contracts with the same name and network
 * @param proxyAdmin (optional) [ROXY_ADMIN_ADDRESS] custom proxy admin address
 */
export const upgrade = async (
  contractName: ContractName,
  deployer: Signer,
  args: unknown[],
  proxy: string,
  proxyAdmin?: string | ProxyAdmin,
  initialize: boolean = false,
  save: boolean = false
): Promise<IUpgradeReturn> => {
  let contractDeployment: PromiseOrValue<IUpgradeDeployment> = getContractDeployment(
    proxy
  ) as Promise<IUpgradeDeployment>;
  //* Proxy Admin
  if (proxyAdmin && typeof proxyAdmin == "string" && isAddress(proxyAdmin)) {
    // use given address as ProxyAdmin
    proxyAdmin = await getContractInstance<ProxyAdmin>("ProxyAdmin", deployer, proxyAdmin);
  } else if (proxyAdmin && typeof proxyAdmin == "string" /*  && !isAddress(proxyAdmin) */) {
    // given a proxy admin but is not an address nor a ProxyAdmin
    throw new Error("String provided as Proxy Admin's address is not an address");
  } else if (proxyAdmin && typeof proxyAdmin != "string") {
    // use given ProxyAdmin
    proxyAdmin = proxyAdmin as ProxyAdmin;
  } else {
    // no proxy admin provided
    if (!(await contractDeployment).admin) {
      throw new Error(`ERROR: No proxy deployment found for proxy address: ${proxy}`);
    }
    proxyAdmin = await getContractInstance<ProxyAdmin>(
      "ProxyAdmin",
      deployer,
      (
        await contractDeployment
      ).admin
    );
  }
  // check if proxy admin is a ProxyAdmin Contract
  try {
    const proxyAdminCode = await deployer.provider!.getCode(proxyAdmin.address);
    if (keccak256(proxyAdminCode) != PROXY_ADMIN_CODEHASH) {
      throw new Error(`ERROR: ProxyAdmin(${proxyAdmin.address}) is not a ProxyAdmin Contract`);
    }
  } catch (error) {
    throw new Error(`ERROR: ProxyAdmin(${proxyAdmin.address}) is not a ProxyAdmin Contract`);
  }
  //* Actual contracts
  const deployResult = await deploy(contractName, deployer, undefined, GAS_OPT.max, {
    offChain: false,
    onChain: false,
  });
  const newLogic = deployResult.contractInstance;
  const timestamp = getContractTimestamp(newLogic);
  if (!newLogic || !newLogic.address) {
    throw new Error("Logic|Implementation not deployed properly");
  }
  console.log(`New logic contract deployed at: ${newLogic.address}`);

  // -- encode function params for TUP
  let initData: string;
  if (initialize) {
    initData = newLogic.interface.encodeFunctionData("initialize", [...args]);
  } else {
    initData = newLogic.interface._encodeParams([], []);
  }
  //* TUP - Transparent Upgradeable Proxy
  contractDeployment = await contractDeployment;
  // Previous Logic
  const previousLogic: Promise<string> = proxyAdmin.getProxyImplementation(
    contractDeployment.proxy
  );
  let receipt: ContractReceipt;
  if (!contractDeployment.proxy) {
    throw new Error("ERROR: contract retrieved is not upgradeable");
  } else if (args.length > 0) {
    console.log(
      `Performing upgrade and call from ${proxyAdmin.address} to proxy ${contractDeployment.proxy} from logic ${contractDeployment.logic} to ${newLogic.address}`
    );
    receipt = await (
      await proxyAdmin.upgradeAndCall(
        contractDeployment.proxy,
        newLogic.address,
        initData,
        GAS_OPT.max
      )
    ).wait();
  } else {
    console.log(
      `Performing upgrade from ${proxyAdmin.address} to proxy ${contractDeployment.proxy} from logic ${contractDeployment.logic} to ${newLogic.address}`
    );
    receipt = await (
      await proxyAdmin.upgrade(contractDeployment.proxy, newLogic.address, GAS_OPT.max)
    ).wait();
  }
  if (!receipt) {
    throw new Error("Transaction execution failed. Undefined Receipt");
  }
  const newLogicFromAdmin: Promise<string> = proxyAdmin.getProxyImplementation(
    contractDeployment.proxy
  );
  if ((await newLogicFromAdmin) == (await previousLogic)) {
    throw new Error("Upgrade failed. Previous address and new one are the same");
  }
  if ((await newLogicFromAdmin) != newLogic.address) {
    throw new Error("Upgrade failed. Logic addresess does not match");
  }

  console.log(`
    Contract upgraded:
      - Proxy Admin: ${proxyAdmin.address}
      - Proxy: ${contractDeployment.proxy}
      - Previous Logic: ${await previousLogic}
      - New Logic: ${await newLogicFromAdmin}
      - Arguments: ${args}
  `);
  // update deployment information
  contractDeployment.logic = newLogic.address;
  contractDeployment.contractName = contractName;
  contractDeployment.logicDeployTxHash = newLogic.deployTransaction.hash;
  contractDeployment.byteCodeHash = keccak256(await deployer.provider!.getCode(newLogic.address));
  contractDeployment.upgradeTimestamp = await timestamp;
  if (save) {
    // store deployment information
    await saveDeployment(contractDeployment);
  }
  return {
    deployment: contractDeployment,
    contractInstance: new Contract(contractDeployment.proxy, newLogic.interface, deployer),
  };
};

export const getLogic = async (
  proxy: string,
  proxyAdmin?: string,
  hre: HardhatRuntimeEnvironment = ghre
) => {
  proxyAdmin = proxyAdmin || (await getProxyAdminDeployment(proxy))?.address;
  if (!proxyAdmin) {
    throw new Error(`ERROR: ${proxy} NOT found in this network`);
  }
  // instanciate the ProxyAdmin
  const proxyAdminContract = await getContractInstance<ProxyAdmin>(
    "ProxyAdmin",
    undefined,
    proxyAdmin
  );

  // check if proxy admin is a ProxyAdmin Contract
  try {
    const proxyAdminCode = await hre.ethers.provider!.getCode(proxyAdmin);
    if (keccak256(proxyAdminCode) != PROXY_ADMIN_CODEHASH) {
      throw new Error(`ERROR: ProxyAdmin(${proxyAdmin}) is not a ProxyAdmin Contract`);
    }
  } catch (error) {
    throw new Error(`ERROR: ProxyAdmin(${proxyAdmin}) is not a ProxyAdmin Contract`);
  }

  const callResults = await Promise.all([
    // get actual logic address directly from the proxy's storage
    hre.ethers.provider.getStorageAt(
      proxy,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    ),
    // get actual admin address directly from the proxy's storage'
    hre.ethers.provider.getStorageAt(
      proxy,
      "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
    ),
    // get actual logic address from ProxyAdmin
    proxyAdminContract.getProxyImplementation(proxy),
    // get actual admin address from ProxyAdmin
    proxyAdminContract.getProxyAdmin(proxy),
  ]);

  // return as an object
  return {
    logicFromProxy: callResults[0],
    adminFromProxy: callResults[1],
    logicFromAdmin: callResults[2],
    adminFromAdmin: callResults[3],
  };
};

export const changeLogic = async (
  proxy: string,
  newLogic: string,
  signer: Signer,
  proxyAdmin?: string
) => {
  proxyAdmin = proxyAdmin || (await getProxyAdminDeployment(proxy))?.address;
  if (!proxyAdmin) {
    throw new Error(`ERROR: ${proxy} NOT found in this network`);
  }
  // instanciate the ProxyAdmin
  const proxyAdminContract = await getContractInstance<ProxyAdmin>(
    "ProxyAdmin",
    signer,
    proxyAdmin
  );

  try {
    const proxyAdminCode = await signer.provider!.getCode(proxyAdmin);
    if (keccak256(proxyAdminCode) != PROXY_ADMIN_CODEHASH) {
      throw new Error(`ERROR: ProxyAdmin(${proxyAdmin}) is not a ProxyAdmin Contract`);
    }
  } catch (error) {
    throw new Error(`ERROR: ProxyAdmin(${proxyAdmin}) is not a ProxyAdmin Contract`);
  }
  // Get logic|implementation address
  const previousLogic = proxyAdminContract.getProxyImplementation(proxy);
  // Change logic contract
  const receipt = await (await proxyAdminContract.upgrade(proxy, newLogic, GAS_OPT.max)).wait();
  // Get logic|implementation address
  const actualLogic = proxyAdminContract.getProxyImplementation(proxy);

  return { previousLogic, actualLogic, receipt };
};

/**
 * Saves a deployments JSON file with the updated deployments information
 * @param deployment deployment object to added to deplyments file
 * @param proxyAdmin (optional ? PROXY_ADMIN_ADDRESS) custom proxy admin address
 */
export const saveDeployment = async (
  deployment: IRegularDeployment | IUpgradeDeployment,
  proxyAdmin?: IRegularDeployment
) => {
  let { networkIndex, netDeployment, deployments } = await getActualNetDeployment();
  // if no deployed yet in this network
  if (networkIndex == undefined) {
    const network = BLOCKCHAIN.networks.get(
      chainIdToNetwork.get(
        gProvider.network ? gProvider.network.chainId : (await gProvider.getNetwork()).chainId
      )
    )!;
    netDeployment = {
      network: {
        name: network.name,
        chainId: network.chainId,
      },
      smartContracts: {
        proxyAdmins: proxyAdmin ? [proxyAdmin] : [],
        contracts: [deployment],
      },
    };
    // add to network deployments array
    deployments.push(netDeployment);
  } else if (netDeployment) {
    // if deployed before in this network
    //* proxy admin
    if (proxyAdmin && netDeployment.smartContracts.proxyAdmins) {
      // if new proxyAdmin and some proxy admin already registered
      const oldIndex = netDeployment.smartContracts.proxyAdmins.findIndex(
        (proxy) => proxy.address == proxyAdmin.address
      );
      if (oldIndex != -1) {
        // found, update proxyAdmin
        netDeployment.smartContracts.proxyAdmins[oldIndex] = proxyAdmin;
      } else {
        // not found, push new proxyAdmin
        netDeployment.smartContracts.proxyAdmins.push(proxyAdmin);
      }
    } else if (proxyAdmin) {
      // network deployment but no Proxy admins
      netDeployment.smartContracts.proxyAdmins = [proxyAdmin];
    }
    //* smart contract
    const upgradeThis = netDeployment.smartContracts.contracts.findIndex(
      (contract) =>
        (contract as IUpgradeDeployment).proxy &&
        (contract as IUpgradeDeployment).proxy == (deployment as IUpgradeDeployment).proxy
    );
    if (upgradeThis != -1) {
      // found, update upgradeable deployment
      netDeployment.smartContracts.contracts[upgradeThis] = deployment;
    } else {
      // not found or not upgradeable
      netDeployment.smartContracts.contracts.push(deployment);
    }
    // replace (update) network deployment
    deployments[networkIndex] = netDeployment;
  }

  // store/write deployments JSON file
  writeFileSync(DEPLOY.deploymentsPath, JSON.stringify(deployments));
};

/**
 * Gets a Proxy Admin Deployment from a Network Deployment from deployments JSON file
 * @param adminAddress address that identifies a Proxy Admin in a network deployment
 * @returns Proxy Admin Deployment object
 */
const getProxyAdminDeployment = async (proxy?: string, adminAddress?: string) => {
  const { networkIndex, netDeployment, deployments } = await getActualNetDeployment();

  if (networkIndex == undefined || !netDeployment) {
    console.log("WARN: there is no deployment for this network");
    return;
  } else if (netDeployment.smartContracts.proxyAdmins) {
    if (proxy && isAddress(proxy)) {
      // if the proxy address is given, get the proxy deployment to get the associated proxyAdmin
      const proxyDep = netDeployment.smartContracts.contracts.find(
        (deployment) => (deployment as IUpgradeDeployment).proxy === proxy
      );
      if (!proxyDep) {
        throw new Error(`ERROR: there is no deployment that match ${proxy} proxy for this network`);
      }
      return netDeployment.smartContracts.proxyAdmins?.find(
        (proxyAdmin) => proxyAdmin.address === (proxyDep as IUpgradeDeployment).admin
      );
    } else if (adminAddress && isAddress(adminAddress)) {
      // if the proxyAdmin address is given, get this proxyAdmin
      return netDeployment.smartContracts.proxyAdmins?.find(
        (proxyAdmin) => proxyAdmin.address === adminAddress
      );
    } else if (proxy || adminAddress) {
      throw new Error("String provided as an address is not an address");
    } else {
      // no address, get first Proxy Admin
      return netDeployment.smartContracts.proxyAdmins[0];
    }
  } else {
    console.log("WARN: there is no Proxy Admin deployed in this network");
    return;
  }
};

/**
 * Gets a Contract Deployment from a Network Deployment from deployments JSON file
 * @param addressOrName address or name that identifies a contract in a network deployment
 * @returns Contract Deployment object
 */
export const getContractDeployment = async (addressOrName: string) => {
  const { networkIndex, netDeployment, deployments } = await getActualNetDeployment();

  if (networkIndex == undefined || !netDeployment) {
    throw new Error("ERROR: there is no deployment for this network");
  } else if (!netDeployment.smartContracts.contracts) {
    throw new Error("ERROR: there is no contracts deployed in this network");
  } else if (isAddress(addressOrName)) {
    return netDeployment.smartContracts.contracts.find(
      (contract) =>
        (contract as IUpgradeDeployment).proxy == addressOrName ||
        (contract as IRegularDeployment).address == addressOrName
    );
  } else {
    // if contract came provided get last deployment with this name
    const contractsFound = netDeployment.smartContracts.contracts.filter(
      (contract) => contract.contractName == addressOrName
    );
    return contractsFound.pop();
  }
};

/**
 * Gets the actual Network Deployment from deployments JSON file
 * @param hre (optional | ghre) use custom HRE
 * @returns Network Deployment object
 */
const getActualNetDeployment = async (hre?: HardhatRuntimeEnvironment) => {
  const network = BLOCKCHAIN.networks.get(
    chainIdToNetwork.get(
      gProvider.network ? gProvider.network.chainId : (await gProvider.getNetwork()).chainId
    )
  )!;
  let deployments: INetworkDeployment[] = [];
  // if the file exists, get previous data
  if (existsSync(DEPLOY.deploymentsPath) && statSync(DEPLOY.deploymentsPath).size > 5) {
    deployments = JSON.parse(readFileSync(DEPLOY.deploymentsPath, "utf-8"));
  } else {
    console.warn("WARN: no deplyments file, createing a new one...");
  }
  // check if network is available in the deployments file
  const networkIndex = deployments.findIndex(
    (netDepl) => netDepl.network.name == network.name && netDepl.network.chainId == network.chainId
  );
  let netDeployment: INetworkDeployment | undefined;
  if (networkIndex !== -1) {
    netDeployment = deployments[networkIndex];
    return {
      networkIndex: networkIndex,
      netDeployment: netDeployment,
      deployments: deployments,
    };
  } else {
    return {
      deployments: deployments,
    };
  }
};
/**
 * Gets the deployed contract timestamp
 * @param contract contract instance to use
 * @param deployTxHash (optional | undefined) it can be used to retrive timestamp
 * @param hre (optional | ghre) use custom HRE
 * @returns ISO string date time representation of the contract timestamp
 */
const getContractTimestamp = async (
  contract: Contract,
  deployTxHash?: string,
  hre?: HardhatRuntimeEnvironment
) => {
  const provider = hre ? hre.ethers.provider : ghre.ethers.provider;

  let receipt: ContractReceipt;
  if (contract.deployTransaction && contract.deployTransaction.hash) {
    receipt = await provider.getTransactionReceipt(contract.deployTransaction.hash);
  } else if (deployTxHash && isAddress(deployTxHash)) {
    receipt = await provider.getTransactionReceipt(deployTxHash);
  } else {
    console.error("ERROR: cannot get Tx from contract or parameter");
    return undefined;
  }
  if (receipt && receipt.blockHash) {
    const timestampSeconds = (await provider.getBlock(receipt.blockHash)).timestamp;
    return new Date(timestampSeconds * 1000).toISOString();
  } else {
    console.error("ERROR: cannot get Tx Block Hash");
    return undefined;
  }
};
