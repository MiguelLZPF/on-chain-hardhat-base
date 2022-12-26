import { DEPLOY, GAS_OPT } from "../configuration";
import { ghre } from "./utils";
import * as fs from "async-file";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract, ContractReceipt, Signer } from "ethers";
import { isAddress, keccak256 } from "ethers/lib/utils";
import {
  INetworkDeployment,
  IRegularDeployment,
  IUpgradeDeployment,
  networks,
} from "../models/Deploy";
import * as ProxyAdmin_Artifact from "../node_modules/@openzeppelin/contracts/build/contracts/ProxyAdmin.json";
import * as TUP_Artifact from "../node_modules/@openzeppelin/contracts/build/contracts/TransparentUpgradeableProxy.json";
import yesno from "yesno";
import { PromiseOrValue } from "../typechain-types/common";
import {
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
} from "../typechain-types";

const PROXY_ADMIN_CODEHASH = keccak256(ProxyAdmin_Artifact.deployedBytecode);

/**
 * Performs a regular deployment and updates the deployment information in deployments JSON file
 * @param contractName name of the contract to be deployed
 * @param deployer signer used to sign deploy transacciation
 * @param args arguments to use in the constructor
 * @param txValue contract creation transaccion value
 */
export const deploy = async (
  contractName: string,
  deployer: Signer,
  args: unknown[],
  txValue = 0
) => {
  const ethers = ghre.ethers;
  const factory = await ethers.getContractFactory(contractName, deployer);
  const contract = await (
    await factory.deploy(...args, { ...GAS_OPT.max, value: txValue })
  ).deployed();
  console.log(`
    Regular contract deployed:
      - Address: ${contract.address}
      - Arguments: ${args}
  `);
  await saveDeployment({
    address: contract.address,
    contractName: contractName,
    deployTimestamp: await getContractTimestamp(contract),
    deployTxHash: contract.deployTransaction.hash,
    byteCodeHash: keccak256(factory.bytecode),
  } as IRegularDeployment);
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
  const proxyAdminContract = new Contract(
    proxyAdmin,
    ProxyAdmin_Artifact.abi,
    hre.ethers.provider
  ) as ProxyAdmin;

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
  const proxyAdminContract = new Contract(
    proxyAdmin,
    ProxyAdmin_Artifact.abi,
    signer
  ) as ProxyAdmin;

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
    const provider = ghre.ethers.provider;
    const network = networks.get(
      provider.network ? provider.network.chainId : (await provider.getNetwork()).chainId
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
  await fs.writeFile(DEPLOY.deploymentsPath, JSON.stringify(deployments));
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
const getContractDeployment = async (addressOrName: string) => {
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
  const provider = hre ? hre.ethers.provider : ghre.ethers.provider;
  const network = networks.get(
    provider.network ? provider.network.chainId : (await provider.getNetwork()).chainId
  )!;
  let deployments: INetworkDeployment[] = [];
  // if the file exists, get previous data
  if (await fs.exists(DEPLOY.deploymentsPath)) {
    deployments = JSON.parse(await fs.readFile(DEPLOY.deploymentsPath));
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
