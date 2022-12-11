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
    privateKey: "0x0e0ff3eacabacf253c9a24351f6e70308cfeaa68c8a2bd67898ecbb0ccdf43d3",
    mnemonic: {
      phrase: "fuel salad early elegant false sleep kangaroo also tuition ready field end",
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
    solVersion: "0.8.13",
    evm: "berlin" as Hardfork,
    gasLimit: 800000, // TODO: check what is the limit
    gasPrice: 0,
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
  lacchainLocal: {
    chainId: 648550,
    hostname: "127.0.0.1",
    port: 4545,
    nodeAddress: "0x211152ca21d5daedbcfbf61173886bbb1a217242",
  },
  lacchainProTest: {
    chainId: 648530, // TODO: check
    hostname: "4.212.240.120",
    port: 443,
    nodeAddress: "0x6ba11f013f25da8a7895a99b0ec6ba9fcdb22494",
  },
};

// default gas options to be used when sending Tx. It aims to zero gas price networks
export const GAS_OPT = {
  max: {
    gasLimit: BLOCKCHAIN.default.gasLimit,
    gasPrice: BLOCKCHAIN.default.gasPrice,
  },
  expiration: 1736394529,
};

export const DEPLOY = {
  deploymentsPath: "deployments.json",
  proxyAdmin: {
    name: "ProxyAdmin",
    address: "", // "0xa978565B473049af66e883C471a725B3C1405f6b", // this address is used as default proxyAdmin for upgradeable deployments
  },
};

export const CONTRACT = {
  vcRegistry: {
    name: "VCRegistry",
  },
  vpRegistry: {
    name: "VPRegistry",
  },
};

export const TEST = {
  accountNumber: 10,
  userNumber: 2,
  issuerNumber: 2,
  verifierNumber: 2,
};
