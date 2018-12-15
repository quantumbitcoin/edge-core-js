// @flow

import { type Disklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { AccountSync } from '../../client-side.js'
import {
  type EdgeAccount,
  type EdgeCreateCurrencyWalletOptions,
  type EdgeCurrencyConfig,
  type EdgeCurrencyWallet,
  type EdgeDataStore,
  type EdgeLobby,
  type EdgePluginData,
  type EdgeRateCache,
  type EdgeSwapConfig,
  type EdgeSwapCurrencies,
  type EdgeSwapQuote,
  type EdgeSwapQuoteOptions,
  type EdgeWalletInfoFull,
  type EdgeWalletStates,
  type EthereumTransaction
} from '../../types/types.js'
import { signEthereumTransaction } from '../../util/crypto/ethereum.js'
import { deprecate } from '../../util/deprecate.js'
import { base58 } from '../../util/encoding.js'
import { getCurrencyPlugin } from '../currency/currency-selectors.js'
import { makeExchangeCache } from '../exchange/exchange-api.js'
import {
  createCurrencyWallet,
  listSplittableWalletTypes,
  makeKeysKit,
  makeStorageKeyInfo,
  splitWalletInfo
} from '../login/keys.js'
import { applyKit } from '../login/login.js'
import { cancelOtpReset, disableOtp, enableOtp } from '../login/otp.js'
import {
  changePassword,
  checkPassword,
  deletePassword
} from '../login/password.js'
import { changePin, checkPin2, deletePin } from '../login/pin2.js'
import { changeRecovery, deleteRecovery } from '../login/recovery2.js'
import { type ApiInput } from '../root-pixie.js'
import { makeStorageWalletApi } from '../storage/storage-api.js'
import { fetchSwapCurrencies, fetchSwapQuote } from '../swap/swap-api.js'
import { changeWalletStates } from './account-files.js'
import { type PluginMap } from './account-reducer.js'
import { makeDataStoreApi, makePluginDataApi } from './data-store-api.js'
import { makeLobbyApi } from './lobby-api.js'
import { CurrencyConfig, SwapConfig } from './plugin-api.js'

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeAccountApi (ai: ApiInput, accountId: string): EdgeAccount {
  const selfState = () => ai.props.state.accounts[accountId]
  const { accountWalletInfo, loginType, loginTree } = selfState()
  const { username } = loginTree

  // Plugin config API's:
  const currencyConfigs: PluginMap<EdgeCurrencyConfig> = {}
  for (const plugin of ai.props.output.currency.plugins) {
    const api = new CurrencyConfig(ai, accountId, plugin)
    currencyConfigs[plugin.pluginName] = api
  }
  const swapConfigs: PluginMap<EdgeSwapConfig> = {}
  for (const pluginName in selfState().swapPlugins) {
    const api = new SwapConfig(ai, accountId, pluginName)
    swapConfigs[pluginName] = api
  }

  // Specialty API's:
  const rateCache = makeExchangeCache(ai)
  const dataStore = makeDataStoreApi(ai, accountId)
  const pluginData = makePluginDataApi(dataStore)
  const storageWalletApi = makeStorageWalletApi(ai, accountWalletInfo)

  function lockdown () {
    if (ai.props.state.hideKeys) {
      throw new Error('Not available when `hideKeys` is enabled')
    }
  }

  const out: EdgeAccount = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get id (): string {
      return storageWalletApi.id
    },
    get type (): string {
      return storageWalletApi.type
    },
    get keys (): Object {
      lockdown()
      return storageWalletApi.keys
    },
    get disklet (): Disklet {
      lockdown()
      return storageWalletApi.disklet
    },
    get localDisklet (): Disklet {
      lockdown()
      return storageWalletApi.localDisklet
    },
    async sync (): Promise<mixed> {
      return storageWalletApi.sync()
    },

    // Basic login information:
    get appId (): string {
      return selfState().login.appId
    },
    get loggedIn (): boolean {
      return selfState() != null
    },
    get loginKey (): string {
      lockdown()
      return base58.stringify(selfState().login.loginKey)
    },
    get recoveryKey (): string | void {
      lockdown()
      const { login } = selfState()
      return login.recovery2Key != null
        ? base58.stringify(login.recovery2Key)
        : void 0
    },
    get username (): string {
      if (!username) throw new Error('Missing username')
      return username
    },

    // Speciality API's:
    get currencyConfig (): { [pluginName: string]: EdgeCurrencyConfig } {
      return currencyConfigs
    },
    get swapConfig (): { [pluginName: string]: EdgeSwapConfig } {
      return swapConfigs
    },
    get rateCache (): EdgeRateCache {
      return rateCache
    },
    get dataStore (): EdgeDataStore {
      return dataStore
    },

    // What login method was used?
    get edgeLogin (): boolean {
      const { loginTree } = selfState()
      return loginTree.loginKey == null
    },
    keyLogin: loginType === 'keyLogin',
    newAccount: loginType === 'newAccount',
    passwordLogin: loginType === 'passwordLogin',
    pinLogin: loginType === 'pinLogin',
    recoveryLogin: loginType === 'recoveryLogin',

    // Change or create credentials:
    async changePassword (password: string): Promise<mixed> {
      lockdown()
      return changePassword(ai, accountId, password).then(() => {})
    },
    async changePin (opts: {
      pin?: string, // We keep the existing PIN if unspecified
      enableLogin?: boolean // We default to true if unspecified
    }): Promise<string> {
      lockdown()
      const { pin, enableLogin } = opts
      return changePin(ai, accountId, pin, enableLogin).then(() => {
        const { login } = selfState()
        return login.pin2Key ? base58.stringify(login.pin2Key) : ''
      })
    },
    async changeRecovery (
      questions: Array<string>,
      answers: Array<string>
    ): Promise<string> {
      lockdown()
      return changeRecovery(ai, accountId, questions, answers).then(() => {
        const { loginTree } = selfState()
        if (!loginTree.recovery2Key) {
          throw new Error('Missing recoveryKey')
        }
        return base58.stringify(loginTree.recovery2Key)
      })
    },

    // Verify existing credentials:
    async checkPassword (password: string): Promise<boolean> {
      lockdown()
      const { loginTree } = selfState()
      return checkPassword(ai, loginTree, password)
    },
    async checkPin (pin: string): Promise<boolean> {
      lockdown()
      const { login, loginTree } = selfState()

      // Try to check the PIN locally, then fall back on the server:
      return login.pin != null
        ? pin === login.pin
        : checkPin2(ai, loginTree, pin)
    },

    // Remove credentials:
    async deletePassword (): Promise<mixed> {
      lockdown()
      return deletePassword(ai, accountId).then(() => {})
    },
    async deletePin (): Promise<mixed> {
      lockdown()
      return deletePin(ai, accountId).then(() => {})
    },
    async deleteRecovery (): Promise<mixed> {
      lockdown()
      return deleteRecovery(ai, accountId).then(() => {})
    },

    // OTP:
    get otpKey (): string | void {
      lockdown()
      const { login } = selfState()
      return login.otpTimeout != null ? login.otpKey : void 0
    },
    get otpResetDate (): string | void {
      lockdown()
      const { login } = selfState()
      return login.otpResetDate
    },
    async cancelOtpReset (): Promise<mixed> {
      lockdown()
      return cancelOtpReset(ai, accountId).then(() => {})
    },
    async enableOtp (timeout: number = 7 * 24 * 60 * 60): Promise<mixed> {
      lockdown()
      return enableOtp(ai, accountId, timeout).then(() => {})
    },
    async disableOtp (): Promise<mixed> {
      lockdown()
      return disableOtp(ai, accountId).then(() => {})
    },

    // Edge login approval:
    async fetchLobby (lobbyId: string): Promise<EdgeLobby> {
      lockdown()
      return makeLobbyApi(ai, accountId, lobbyId)
    },

    // Login management:
    async logout (): Promise<mixed> {
      ai.props.dispatch({ type: 'LOGOUT', payload: { accountId } })
    },

    // Master wallet list:
    get allKeys (): Array<EdgeWalletInfoFull> {
      return ai.props.state.hideKeys
        ? ai.props.state.accounts[accountId].allWalletInfosClean
        : ai.props.state.accounts[accountId].allWalletInfosFull
    },
    async changeWalletStates (walletStates: EdgeWalletStates): Promise<mixed> {
      return changeWalletStates(ai, accountId, walletStates)
    },
    async createWallet (type: string, keys: any): Promise<string> {
      const { login, loginTree } = selfState()

      if (keys == null) {
        // Use the currency plugin to create the keys:
        const plugin = getCurrencyPlugin(ai.props.output.currency.plugins, type)
        keys = await plugin.createPrivateKey(type)
      }

      const walletInfo = makeStorageKeyInfo(ai, type, keys)
      const kit = makeKeysKit(ai, login, walletInfo)
      return applyKit(ai, loginTree, kit).then(() => walletInfo.id)
    },
    getFirstWalletInfo: AccountSync.prototype.getFirstWalletInfo,
    getWalletInfo: AccountSync.prototype.getWalletInfo,
    listWalletIds: AccountSync.prototype.listWalletIds,
    async splitWalletInfo (
      walletId: string,
      newWalletType: string
    ): Promise<string> {
      return splitWalletInfo(ai, accountId, walletId, newWalletType)
    },
    async listSplittableWalletTypes (walletId: string): Promise<Array<string>> {
      return listSplittableWalletTypes(ai, accountId, walletId)
    },

    // Currency wallets:
    get activeWalletIds (): Array<string> {
      return ai.props.state.accounts[accountId].activeWalletIds
    },
    get archivedWalletIds (): Array<string> {
      return ai.props.state.accounts[accountId].archivedWalletIds
    },
    get currencyWallets (): { [walletId: string]: EdgeCurrencyWallet } {
      return ai.props.output.accounts[accountId].currencyWallets
    },
    async createCurrencyWallet (
      type: string,
      opts?: EdgeCreateCurrencyWalletOptions = {}
    ): Promise<EdgeCurrencyWallet> {
      return createCurrencyWallet(ai, accountId, type, opts)
    },
    async waitForCurrencyWallet (walletId: string): Promise<EdgeCurrencyWallet> {
      return new Promise(resolve => {
        const f = currencyWallets => {
          const wallet = this.currencyWallets[walletId]
          if (wallet != null) {
            resolve(wallet)
            unsubscribe()
          }
        }
        const unsubscribe = this.watch('currencyWallets', f)
        f()
      })
    },

    async signEthereumTransaction (
      walletId: string,
      transaction: EthereumTransaction
    ): Promise<string> {
      console.log('Edge is signing: ', transaction)
      const { allWalletInfosFull } = selfState()
      const walletInfo = allWalletInfosFull.find(info => info.id === walletId)
      if (!walletInfo || !walletInfo.keys || !walletInfo.keys.ethereumKey) {
        throw new Error('Cannot find the requested private key in the account')
      }
      return signEthereumTransaction(walletInfo.keys.ethereumKey, transaction)
    },

    async fetchSwapCurrencies (): Promise<EdgeSwapCurrencies> {
      return fetchSwapCurrencies(ai, accountId)
    },
    async fetchSwapQuote (opts: EdgeSwapQuoteOptions): Promise<EdgeSwapQuote> {
      return fetchSwapQuote(ai, accountId, opts)
    },

    // Deprecated names:
    get currencyTools (): { [pluginName: string]: EdgeCurrencyConfig } {
      return currencyConfigs
    },
    get exchangeTools (): { [pluginName: string]: EdgeSwapConfig } {
      return swapConfigs
    },
    get exchangeCache (): EdgeRateCache {
      return rateCache
    },
    get pluginData (): EdgePluginData {
      return pluginData
    },
    async getExchangeCurrencies (): Promise<EdgeSwapCurrencies> {
      deprecate(
        'EdgeAccount.getExchangeCurrencies',
        'EdgeAccount.fetchSwapCurrencies'
      )
      return this.fetchSwapCurrencies()
    },
    async getExchangeQuote (opts: EdgeSwapQuoteOptions): Promise<EdgeSwapQuote> {
      deprecate('EdgeAccount.getExchangeQuote', 'EdgeAccount.fetchSwapQuote')
      return this.fetchSwapQuote(opts)
    }
  }
  bridgifyObject(out)

  return out
}
