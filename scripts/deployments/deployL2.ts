require('dotenv').config()

import { ethers } from 'hardhat'
import {
  ContractFactory,
  Signer,
  Contract,
  BigNumber,
  providers
} from 'ethers'

import {
  getContractFactories,
  updateConfigFile,
  readConfigFile,
  waitAfterTransaction,
  doesNeedExplicitGasLimit,
  Logger
} from '../shared/utils'

import {
  isChainIdMainnet,
  isChainIdPolygon,
  getPolygonFxChildAddress,
  getL2BridgeDefaults
} from '../../config/utils'

import {
  CHAIN_IDS,
  DEFAULT_ETHERS_OVERRIDES as overrides,
  DEFAULT_SWAP_A,
  DEFAULT_SWAP_FEE,
  DEFAULT_SWAP_ADMIN_FEE,
  DEFAULT_SWAP_WITHDRAWAL_FEE,
  DEFAULT_ADMIN_ROLE_HASH,
  ZERO_ADDRESS
} from '../../config/constants'

const logger = Logger('deployL2')

interface Config {
  l1_chainId: string | BigNumber
  l2_chainId: string | BigNumber
  l1_bridgeAddress: string
  l1_messengerWrapperAddress: string
  l2_canonicalTokenAddress: string
  l2_messengerAddress: string
  l2_hBridgeTokenName: string
  l2_hBridgeTokenSymbol: string
  l2_hBridgeTokenDecimals: number
  l2_swapLpTokenName: string
  l2_swapLpTokenSymbol: string
}

export async function deployL2 (config: Config) {
  logger.log('deploy L2')

  let {
    l1_chainId,
    l2_chainId,
    l1_bridgeAddress,
    l1_messengerWrapperAddress,
    l2_canonicalTokenAddress,
    l2_messengerAddress,
    l2_hBridgeTokenName,
    l2_hBridgeTokenSymbol,
    l2_hBridgeTokenDecimals,
    l2_swapLpTokenName,
    l2_swapLpTokenSymbol
  } = config

  logger.log(`config:
            l1_chainId: ${l1_chainId}
            l2_chainId: ${l2_chainId}
            l1_bridgeAddress: ${l1_bridgeAddress}
            l1_messengerWrapper: ${l1_messengerWrapperAddress}
            l2_canonicalTokenAddress: ${l2_canonicalTokenAddress}
            l2_messengerAddress: ${l2_messengerAddress}
            l2_hBridgeTokenName: ${l2_hBridgeTokenName}
            l2_hBridgeTokenSymbol: ${l2_hBridgeTokenSymbol}
            l2_hBridgeTokenDecimals: ${l2_hBridgeTokenDecimals}`)

  l1_chainId = BigNumber.from(l1_chainId)
  l2_chainId = BigNumber.from(l2_chainId)

  // Signers
  let accounts: Signer[]
  let owner: Signer
  let bonder: Signer
  let governance: Signer

  // Factories
  let L1_Bridge: ContractFactory
  let L2_MockERC20: ContractFactory
  let L2_HopBridgeToken: ContractFactory
  let L2_Bridge: ContractFactory
  let L2_AmmWrapper: ContractFactory
  let L2_MessengerProxy: ContractFactory

  // Contracts
  let l1_bridge: Contract
  let l2_bridge: Contract
  let l2_canonicalToken: Contract
  let l2_hopBridgeToken: Contract
  let l2_swap: Contract
  let l2_ammWrapper: Contract
  let l2_messengerProxy: Contract

  // Instantiate the wallets
  accounts = await ethers.getSigners()

  if (isChainIdMainnet(l1_chainId)) {
    owner = accounts[0]
    bonder = owner
    governance = owner
  } else {
    owner = accounts[0]
    bonder = accounts[1]
    governance = accounts[4]
  }

  logger.log('owner:', await owner.getAddress())
  logger.log('bonder:', await bonder.getAddress())
  logger.log('governance:', await governance.getAddress())

  // Transaction
  let tx: providers.TransactionResponse

  logger.log('getting contract factories')
  // Get the contract Factories
  ;({
    L1_Bridge,
    L2_MockERC20,
    L2_HopBridgeToken,
    L2_Bridge,
    L2_AmmWrapper,
    L2_MessengerProxy
  } = await getContractFactories(l2_chainId, owner, ethers))

  logger.log('attaching deployed contracts')
  // Attach already deployed contracts
  l1_bridge = L1_Bridge.attach(l1_bridgeAddress)
  l2_canonicalToken = L2_MockERC20.attach(l2_canonicalTokenAddress)

  /**
   * Deployments
   */


  let l2_messengerProxyAddress: string = ''
  if (isChainIdPolygon(l2_chainId)) {
    l2_messengerProxy = await L2_MessengerProxy.deploy()
    await waitAfterTransaction(l2_messengerProxy, ethers)
    l2_messengerAddress = l2_messengerProxy.address
  }

  logger.log('deploying L2 hop bridge token')
  l2_hopBridgeToken = await L2_HopBridgeToken.deploy(
    l2_hBridgeTokenName,
    l2_hBridgeTokenSymbol,
    l2_hBridgeTokenDecimals
  )
  await waitAfterTransaction(l2_hopBridgeToken, ethers)

  logger.log('deploying L2 swap contract')
  ;({ l2_swap } = await deployAmm(
    owner,
    ethers,
    l2_chainId,
    l2_canonicalToken,
    l2_hopBridgeToken,
    l2_swapLpTokenName,
    l2_swapLpTokenSymbol
  ))

  logger.log('deploying L2 bridge and L2 amm wrapper')
  ;({ l2_bridge, l2_ammWrapper } = await deployBridge(
    l2_chainId,
    l1_chainId,
    ethers,
    owner,
    bonder,
    governance,
    L2_Bridge,
    L2_AmmWrapper,
    l1_bridge,
    l2_bridge,
    l2_hopBridgeToken,
    l2_canonicalToken,
    l2_swap,
    l2_ammWrapper,
    l2_messengerAddress,
    l2_messengerProxyAddress
  ))

  logger.log('deploying network specific contracts')

  // Transfer ownership of the Hop Bridge Token to the L2 Bridge
  let transferOwnershipParams: any[] = [l2_bridge.address]
  if (doesNeedExplicitGasLimit(l2_chainId)) {
    transferOwnershipParams.push(overrides)
  }

  logger.log('transferring ownership of L2 hop bridge token')
  tx = await l2_hopBridgeToken.transferOwnership(...transferOwnershipParams)
  await tx.wait()
  await waitAfterTransaction()

  if (isChainIdPolygon(l2_chainId)) {
    let tx = await l2_messengerProxy.setL2Bridge(l2_bridge.address, overrides)
    await tx.wait()
    await waitAfterTransaction()

    await l2_messengerProxy.setFxRootTunnel(l1_messengerWrapperAddress)
    await tx.wait()
    await waitAfterTransaction()

    const fxChild: string = getPolygonFxChildAddress(l1_chainId)
    await l2_messengerProxy.setFxChild(fxChild)
    await tx.wait()
    await waitAfterTransaction()
  }

  const l2_hopBridgeTokenAddress: string = l2_hopBridgeToken.address
  const l2_bridgeAddress: string = l2_bridge.address
  const l2_swapAddress: string = l2_swap.address
  const l2_ammWrapperAddress: string = l2_ammWrapper.address

  logger.log('L2 Deployments Complete')
  logger.log('L2 Hop Bridge Token :', l2_hopBridgeTokenAddress)
  logger.log('L2 Bridge           :', l2_bridgeAddress)
  logger.log('L2 Swap             :', l2_swapAddress)
  logger.log('L2 Amm Wrapper      :', l2_ammWrapperAddress)
  logger.log('L2 Messenger        :', l2_messengerAddress)
  logger.log('L2 Messenger Proxy  :', l2_messengerProxyAddress)

  updateConfigFile({
    l2_hopBridgeTokenAddress,
    l2_bridgeAddress,
    l2_swapAddress,
    l2_ammWrapperAddress,
    l2_messengerAddress,
    l2_messengerProxyAddress
  })

  return {
    l2_hopBridgeTokenAddress,
    l2_bridgeAddress,
    l2_swapAddress,
    l2_ammWrapperAddress,
    l2_messengerAddress,
    l2_messengerProxyAddress
  }
}

const deployAmm = async (
  owner: Signer,
  ethers: any,
  l2_chainId: BigNumber,
  l2_canonicalToken: Contract,
  l2_hopBridgeToken: Contract,
  l2_swapLpTokenName: string,
  l2_swapLpTokenSymbol: string
) => {

  let decimalParams: any[] = []

  if (doesNeedExplicitGasLimit(l2_chainId)) {
    decimalParams.push(overrides)
  }

  const l2_canonicalTokenDecimals = await l2_canonicalToken.decimals(...decimalParams)
  const l2_hopBridgeTokenDecimals = await l2_hopBridgeToken.decimals(...decimalParams)

  // Deploy AMM contracts
  const L2_SwapContractFactory: ContractFactory = await deployL2SwapLibs(owner, ethers)
  const l2_swap = await L2_SwapContractFactory.deploy()
  await waitAfterTransaction(l2_swap, ethers)

  let initializeParams: any[] = [
    [l2_canonicalToken.address, l2_hopBridgeToken.address],
    [l2_canonicalTokenDecimals, l2_hopBridgeTokenDecimals],
    l2_swapLpTokenName,
    l2_swapLpTokenSymbol,
    DEFAULT_SWAP_A,
    DEFAULT_SWAP_FEE,
    DEFAULT_SWAP_ADMIN_FEE,
    DEFAULT_SWAP_WITHDRAWAL_FEE
  ]

  if (doesNeedExplicitGasLimit(l2_chainId)) {
    initializeParams.push(overrides)
  }

  const tx = await l2_swap.initialize(...initializeParams)
  await tx.wait()
  await waitAfterTransaction()

  return {
    l2_swap
  }
}

const deployL2SwapLibs = async (
  signer: Signer,
  ethers: any
) => {
  const L2_MathUtils: ContractFactory = await ethers.getContractFactory('MathUtils', { signer })
  const l2_mathUtils = await L2_MathUtils.deploy()
  await waitAfterTransaction(l2_mathUtils, ethers)

  const L2_SwapUtils = await ethers.getContractFactory(
    'SwapUtils',
    {
      libraries: {
        'MathUtils': l2_mathUtils.address
      }
    }
  )

  const l2_swapUtils = await L2_SwapUtils.deploy()
  await waitAfterTransaction(l2_swapUtils, ethers)

  return await ethers.getContractFactory(
    'Swap',
    {
      libraries: {
        'SwapUtils': l2_swapUtils.address
      }
    }
  )
}

const deployBridge = async (
  chainId: BigNumber,
  l1ChainId: BigNumber,
  ethers: any,
  owner: Signer,
  bonder: Signer,
  governance: Signer,
  L2_Bridge: ContractFactory,
  L2_AmmWrapper: ContractFactory,
  l1_bridge: Contract,
  l2_bridge: Contract,
  l2_hopBridgeToken: Contract,
  l2_canonicalToken: Contract,
  l2_swap: Contract,
  l2_ammWrapper: Contract,
  l2_messengerAddress: string,
  l2_messengerProxyAddress: string
) => {
  // NOTE: Adding more CHAIN_IDs here will push the OVM deployment over the contract size limit
  //       If additional CHAIN_IDs must be added, do so after the deployment.
  const l2BridgeDeploymentParams = getL2BridgeDefaults(
    chainId,
    l2_messengerAddress,
    l2_messengerProxyAddress,
    await governance.getAddress(),
    l2_hopBridgeToken.address,
    l1_bridge.address,
    [CHAIN_IDS.ETHEREUM.MAINNET.toString()],
    [await bonder.getAddress()],
    l1ChainId
  )

  l2_bridge = await L2_Bridge.connect(owner).deploy(...l2BridgeDeploymentParams)
  await waitAfterTransaction(l2_bridge, ethers)

  const l2CanonicalTokenName = await l2_canonicalToken.symbol(overrides)
  const l2CanonicalTokenIsEth: boolean = l2CanonicalTokenName === 'WETH'
  l2_ammWrapper = await L2_AmmWrapper.connect(owner).deploy(
    l2_bridge.address,
    l2_canonicalToken.address,
    l2CanonicalTokenIsEth,
    l2_hopBridgeToken.address,
    l2_swap.address
  )
  await waitAfterTransaction(l2_ammWrapper, ethers)

  return {
    l2_bridge,
    l2_ammWrapper
  }
}

if (require.main === module) {
  const {
    l1_chainId,
    l2_chainId,
    l1_bridgeAddress,
    l1_messengerWrapperAddress,
    l2_canonicalTokenAddress,
    l2_messengerAddress,
    l2_hBridgeTokenName,
    l2_hBridgeTokenSymbol,
    l2_hBridgeTokenDecimals,
    l2_swapLpTokenName,
    l2_swapLpTokenSymbol
  } = readConfigFile()
  deployL2({
    l1_chainId,
    l2_chainId,
    l1_bridgeAddress,
    l1_messengerWrapperAddress,
    l2_canonicalTokenAddress,
    l2_messengerAddress,
    l2_hBridgeTokenName,
    l2_hBridgeTokenSymbol,
    l2_hBridgeTokenDecimals,
    l2_swapLpTokenName,
    l2_swapLpTokenSymbol
  })
    .then(() => {
      process.exit(0)
    })
    .catch(error => {
      logger.error(error)
      process.exit(1)
    })
}
