type Hardfork = "london" | "berlin" | "byzantium";

/**
 * The KEYSTORE environment constant group is used to agrupate the constants related to the Encryped JSON wallets
 * @param root the root directory
 * @param default default constants if no specific ones defined
 * @param default.password to be used to symetric encryption & decryption of the Encryped JSON wallets
 * @param default.batchSize the number of Encryped JSON wallets to generate in batch mode
 * @param test constants related to tests
 * @param test.userNumber number of users to create in tests
 */
export const KEYSTORE = {
  root: "keystore",
  default: {
    accountNumber: 10, // Ganache server default account number
    balance: "0x2710", // infinite balance
    password: "PaSs_W0Rd", // should use another password for real things
    privateKey: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    mnemonic: {
      phrase: "myth like bonus scare over problem client lizard pioneer submit female collect",
      path: "m/44'/60'/0'/0/0",
      basePath: "m/44'/60'/0'/0",
      locale: "en",
    },
    batchSize: 2, // hardhat task default wallets to add to the keystore in batch mode
  },
};

/**
 * The BLOCKCHAIN environment constant group is used to agrupate the constants related to the blockchain network
 */
export const BLOCKCHAIN = {
  default: {
    solVersion: "0.8.17",
    evm: "london" as Hardfork,
    gasLimit: 800000,
    gasPrice: 0,
    maxFeePerGas: 900000000,
    maxPriorityFeePerGas: 100,
    initialBaseFeePerGas: 7,
  },
  hardhat: {
    chainId: 31337,
    hostname: "127.0.0.1",
    port: 8545,
  },
  ganache: {
    chainId: 1337,
    hostname: "127.0.0.1",
    port: 8545,
    dbPath: ".ganache-db",
  },
};

// default gas options to be used when sending Tx. It aims to zero gas price networks
export const GAS_OPT = {
  max: {
    gasLimit: BLOCKCHAIN.default.gasLimit,
    // gasPrice: BLOCKCHAIN.default.gasPrice,
    maxPriorityFeePerGas: BLOCKCHAIN.default.maxPriorityFeePerGas,
    maxFeePerGas: BLOCKCHAIN.default.maxFeePerGas,
  },
};

export const DEPLOY = {
  deploymentsPath: "scr-deployments.json",
};

export const CONTRACT = {
  // system contracts
  codeTrust: {
    name: "CodeTrust",
    address: "", // if set can be used as default value for some methods
  },
  contractRegistry: {
    name: "ContractRegistry",
    address: "", // if set can be used as default value for some methods
  },
  contractDeployer: {
    name: "ContractDeployer",
    address: "", // if set can be used as default value for some methods
  },
  upgradeableDeployer: {
    name: "UpgradeableDeployer",
    address: "", // if set can be used as default value for some methods
  },
  // development contracts
  lock: {
    name: "Lock",
  },
  lockUpgradeable: {
    name: "LockUpgr",
  },
};

export const TEST = {
  accountNumber: 10,
};
