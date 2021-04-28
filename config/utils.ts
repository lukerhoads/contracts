import { BigNumber, utils as ethersUtils } from 'ethers'
import {
  IGetL2BridgeDefaults
} from './interfaces'
import {
  CHAIN_IDS,
  DEFAULT_MESSENGER_WRAPPER_GAS_LIMIT,
  DEFAULT_MESSENGER_WRAPPER_GAS_PRICE,
  DEFAULT_MESSENGER_WRAPPER_CALL_VALUE,
  DEFAULT_L2_BRIDGE_GAS_LIMIT,
  CHECKPOINT_MANAGER_ADDRESSES,
  STATE_SENDER_ADDRESSES
} from './constants'

export const getMessengerWrapperDefaults = (
  chainId: BigNumber,
  l1BridgeAddress: string,
  l2BridgeAddress: string,
  l1MessengerAddress: string
): any[] => {
  // Ending data to return
  let data: any = []

  // Defaults for most chains
  let defaults: any[] = [
    l1BridgeAddress,
    l2BridgeAddress,
    l1MessengerAddress
  ]

  if (isChainIdArbitrum(chainId)) {
    const gasLimit: number = DEFAULT_MESSENGER_WRAPPER_GAS_LIMIT
    const gasPrice: number = DEFAULT_MESSENGER_WRAPPER_GAS_PRICE
    const callValue: number = DEFAULT_MESSENGER_WRAPPER_CALL_VALUE

    data.push(
      ...defaults,
      gasLimit,
      gasPrice,
      callValue
    )
  } else if (isChainIdOptimism(chainId)) {
    const gasLimit: number = DEFAULT_MESSENGER_WRAPPER_GAS_LIMIT

    data.push(
      ...defaults,
      gasLimit
    )
  } else if (isChainIdXDai(chainId)) {
    const gasLimit: number = 1000000
    const isAmbL1: boolean = true
    const ambAddress: string = getXDaiAmbAddresses(isAmbL1)

    data.push(
      ...defaults,
      gasLimit,
      chainId.toString(),
      ambAddress
    )
  } else if (isChainIdPolygon(chainId)) {
    data.push(
      l1BridgeAddress
    )
  }

  return data
}

export const getL2BridgeDefaults = (
  chainId: BigNumber,
  l2MessengerAddress: string,
  l2MessengerProxyAddress: string,
  governanceAddress: string,
  l2HopBridgeTokenAddress: string,
  l1BridgeAddress: string,
  activeChainIds: string[],
  bonderAddresses: string[],
  l1ChainId: BigNumber
): IGetL2BridgeDefaults[] => {
  let defaults: IGetL2BridgeDefaults[] = []

  let actualL2MessengerAddress: string = l2MessengerAddress
  let additionalData = []

  if (isChainIdArbitrum(chainId)) {
    // No additional data needed
  } else if (isChainIdOptimism(chainId)) {
    const defaultGasLimit = DEFAULT_L2_BRIDGE_GAS_LIMIT
    additionalData.push(defaultGasLimit)
  } else if (isChainIdXDai(chainId)) {
    additionalData.push(
      l1ChainId,
      DEFAULT_L2_BRIDGE_GAS_LIMIT
    )
  } else if (isChainIdPolygon(chainId)) {
    actualL2MessengerAddress = l2MessengerProxyAddress
  }

  defaults.push(
    actualL2MessengerAddress,
    governanceAddress,
    l2HopBridgeTokenAddress,
    l1BridgeAddress,
    activeChainIds,
    bonderAddresses
  )

  if (additionalData.length !== 0) {
    defaults.push(...additionalData)
  }

  return defaults
}

export const isChainIdOptimism = (chainId: BigNumber): boolean => {
  if (
    chainId.eq(CHAIN_IDS.OPTIMISM.TESTNET_1) ||
    chainId.eq(CHAIN_IDS.OPTIMISM.SYNTHETIX_DEMO) ||
    chainId.eq(CHAIN_IDS.OPTIMISM.HOP_TESTNET)
  ) {
    return true
  }

  return false
}

export const isChainIdArbitrum = (chainId: BigNumber): boolean => {
  if (
    chainId.eq(CHAIN_IDS.ARBITRUM.TESTNET_2) ||
    chainId.eq(CHAIN_IDS.ARBITRUM.TESTNET_3) ||
    chainId.eq(CHAIN_IDS.ARBITRUM.TESTNET_4)
  ) {
    return true
  }

  return false
}

export const isChainIdXDai = (chainId: BigNumber): boolean => {
  if (chainId.eq(CHAIN_IDS.XDAI.SOKOL) ||
      chainId.eq(CHAIN_IDS.XDAI.XDAI)
  ) {
    return true
  }

  return false
}

export const isChainIdPolygon = (chainId: BigNumber): boolean => {
  if (
    chainId.eq(CHAIN_IDS.POLYGON.MUMBAI) ||
    chainId.eq(CHAIN_IDS.POLYGON.MAINNET)
  ) {
    return true
  }

  return false
}

export const isChainIdMainnet = (chainId: BigNumber): boolean => {
  if (
    chainId.eq(CHAIN_IDS.ETHEREUM.MAINNET)
  ) {
    return true
  }

  return false
}

export const isChainIdGoerli = (chainId: BigNumber): boolean => {
  if (
    chainId.eq(CHAIN_IDS.ETHEREUM.GOERLI)
  ) {
    return true
  }

  return false
}

export const isChainIdKovan = (chainId: BigNumber): boolean => {
  if (
    chainId.eq(CHAIN_IDS.ETHEREUM.KOVAN)
  ) {
    return true
  }

  return false
}

export const getXDaiAmbAddresses = (isAmbL1: boolean): string => {
  const kovanAmbAddress: string = '0xFe446bEF1DbF7AFE24E81e05BC8B271C1BA9a560'
  const sokolAmbAddress: string = '0xFe446bEF1DbF7AFE24E81e05BC8B271C1BA9a560'
  if (isAmbL1) {
    return kovanAmbAddress
  }
  return sokolAmbAddress
}

// Create an array of strings for each supported chain ID
export const getAllActiveChainIds = (obj: any): string[] =>
  obj && obj instanceof Object
    ? Object.values(obj)
        .map(getAllActiveChainIds)
        .reduce((a: string[], b: any) => a.concat(b), [] as any[])
        .filter((a: any) => typeof a === 'string')
    : [obj]

export const getPolygonStateSenderAddress = (l1ChainId: BigNumber): string => {
  if (isChainIdMainnet(l1ChainId)) {
    return STATE_SENDER_ADDRESSES.MAINNET
  } else if (isChainIdGoerli(l1ChainId)) {
    return STATE_SENDER_ADDRESSES.GOERLI
  } else {
    throw new Error('Invalid Chain ID')
  }
}

export const getPolygonCheckpointManagerAddress = (l1ChainId: BigNumber): string => {
  if (isChainIdMainnet(l1ChainId)) {
    return CHECKPOINT_MANAGER_ADDRESSES.MAINNET
  } else if (isChainIdGoerli(l1ChainId)) {
    return CHECKPOINT_MANAGER_ADDRESSES.GOERLI
  } else {
    throw new Error('Invalid Chain ID')
  }
}