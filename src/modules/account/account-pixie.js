// @flow

import {
  type PixieInput,
  type TamePixie,
  combinePixies,
  mapPixie,
  stopUpdates
} from 'redux-pixies'
import { close, emit, update } from 'yaob'

import {
  type EdgeAccount,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapTools
} from '../../types/types.js'
import { waitForCurrencyPlugins } from '../currency/currency-selectors.js'
import { type ApiInput, type RootProps } from '../root-pixie.js'
import {
  addStorageWallet,
  syncStorageWallet
} from '../storage/storage-actions.js'
import { changellyPlugin } from '../swap/changelly-plugin.js'
import { changenowPlugin } from '../swap/changenow-plugin'
import { shapeshiftPlugin } from '../swap/shapeshift-plugin.js'
import { makeAccountApi } from './account-api.js'
import { loadAllWalletStates, reloadPluginSettings } from './account-files.js'
import { type AccountState, type PluginMap } from './account-reducer.js'

export type AccountOutput = {
  +api: EdgeAccount,
  +currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
}

export type AccountProps = RootProps & {
  +id: string,
  +selfState: AccountState,
  +selfOutput: AccountOutput
}

export type AccountInput = PixieInput<AccountProps>

const accountPixie: TamePixie<AccountProps> = combinePixies({
  api (input: AccountInput) {
    let timer
    let onLoggedOut

    return {
      destroy () {
        // The Pixie library stops updating props after destruction,
        // so we are stuck seeing the logged-in state. Fix that:
        const hack: any = input.props
        hack.state = { accounts: {} }

        if (timer != null) clearTimeout(timer)
        if (onLoggedOut) onLoggedOut()
        if (
          input.props.selfOutput != null &&
          input.props.selfOutput.api != null
        ) {
          update(input.props.selfOutput.api)
          close(input.props.selfOutput.api)
          close(input.props.selfOutput.api.dataStore)
          close(input.props.selfOutput.api.exchangeCache)
          close(input.props.selfOutput.api.pluginData)
          const currencies = input.props.selfOutput.api.currencyConfig
          for (const n of Object.keys(currencies)) close(currencies[n])
          const swaps = input.props.selfOutput.api.swapConfig
          for (const n of Object.keys(swaps)) close(swaps[n])
        }
      },

      async update () {
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const accountId = input.props.id
        const io = input.props.io
        const { callbacks, accountWalletInfos } = input.props.selfState
        onLoggedOut = callbacks.onLoggedOut

        const loadAllFiles = async () => {
          await Promise.all([
            reloadPluginSettings(ai, accountId),
            loadAllWalletStates(ai, accountId)
          ])

          if (callbacks.onDataChanged) {
            callbacks.onDataChanged()
          }
        }

        try {
          // Wait for the currency plugins (should already be loaded by now):
          await waitForCurrencyPlugins(ai)
          io.console.info('Login: currency plugins exist')

          // Start the repo:
          await Promise.all(
            accountWalletInfos.map(info => addStorageWallet(ai, info))
          )
          io.console.info('Login: synced account repos')

          await loadAllFiles()
          io.console.info('Login: loaded files')

          // Load swap plugins:
          const swapPlugins: PluginMap<EdgeSwapPlugin> = {}
          const swapTools: PluginMap<EdgeSwapTools> = {}
          if (input.props.changellyInit) {
            swapPlugins.changelly = changellyPlugin
            swapTools.changelly = await changellyPlugin.makeTools({
              io: input.props.io,
              initOptions: input.props.changellyInit,
              get userSettings () {
                return input.props.selfState.userSettings.changelly
              }
            })
          }
          if (input.props.shapeshiftKey != null) {
            swapPlugins.shapeshift = shapeshiftPlugin
            swapTools.shapeshift = await shapeshiftPlugin.makeTools({
              io: input.props.io,
              initOptions: { apiKey: input.props.shapeshiftKey },
              get userSettings () {
                return input.props.selfState.userSettings.shapeshift
              }
            })
          }
          if (input.props.changeNowKey) {
            swapPlugins.changenow = changenowPlugin
            swapTools.changenow = await changenowPlugin.makeTools({
              io: input.props.io,
              initOptions: { apiKey: input.props.changeNowKey },
              get userSettings () {
                return input.props.selfState.userSettings.changenow
              }
            })
          }
          input.props.dispatch({
            type: 'ACCOUNT_SWAP_PLUGINS_LOADED',
            payload: { accountId, swapPlugins, swapTools }
          })

          // Create the API object:
          input.onOutput(makeAccountApi(ai, accountId))
          io.console.info('Login: complete')

          // Start the sync timer:
          const startTimer = () => {
            timer = setTimeout(async () => {
              try {
                if (input.props.state.accounts[accountId] == null) return
                const changeLists = await Promise.all(
                  accountWalletInfos.map(info => syncStorageWallet(ai, info.id))
                )
                const changes: Array<string> = [].concat(...changeLists)
                if (changes.length) loadAllFiles()
              } catch (e) {
                // We don't report sync failures, since that could be annoying.
                // Maybe once we have online / offline detection working.
              } finally {
                startTimer()
              }
            }, 30 * 1000)
          }
          startTimer()
        } catch (error) {
          input.props.dispatch({
            type: 'ACCOUNT_LOAD_FAILED',
            payload: { accountId, error }
          })
        }

        return stopUpdates
      }
    }
  },

  watcher (input: AccountInput) {
    let lastState
    let lastWalletInfos
    let lastWallets
    let lastExchangeState

    return () => {
      const { selfState, selfOutput } = input.props
      if (selfState == null || selfOutput == null) return

      // General account state:
      if (lastState !== selfState) {
        lastState = selfState
        if (selfOutput.api != null) update(selfOutput.api)
      }

      // onKeyListChanged callback:
      if (lastWalletInfos !== selfState.walletInfos) {
        lastWalletInfos = selfState.walletInfos
        const { onKeyListChanged } = selfState.callbacks
        if (onKeyListChanged) onKeyListChanged()
      }

      // Wallet list:
      if (lastWallets !== input.props.output.currency.wallets) {
        lastWallets = input.props.output.currency.wallets
        if (selfOutput.api != null) update(selfOutput.api)
      }

      // Exchange:
      if (lastExchangeState !== input.props.state.exchangeCache) {
        lastExchangeState = input.props.state.exchangeCache
        if (selfOutput.api != null) {
          emit(selfOutput.api.exchangeCache, 'update', void 0)
        }
      }
    }
  },

  currencyWallets (input: AccountInput) {
    let lastActiveWalletIds

    return () => {
      const { activeWalletIds } = input.props.selfState
      let dirty = lastActiveWalletIds !== activeWalletIds
      lastActiveWalletIds = activeWalletIds

      let lastOut = {}
      if (input.props.selfOutput && input.props.selfOutput.currencyWallets) {
        lastOut = input.props.selfOutput.currencyWallets
      }

      const out = {}
      for (const walletId of activeWalletIds) {
        if (
          input.props.output.currency.wallets[walletId] != null &&
          input.props.output.currency.wallets[walletId].api != null
        ) {
          const api = input.props.output.currency.wallets[walletId].api
          if (api !== lastOut[walletId]) dirty = true
          out[walletId] = api
        }
      }

      if (dirty) input.onOutput(out)
    }
  }
})

export const accounts: TamePixie<RootProps> = mapPixie(
  accountPixie,
  (props: RootProps) => props.state.accountIds,
  (props: RootProps, id: string): AccountProps => ({
    ...props,
    id,
    selfState: props.state.accounts[id],
    selfOutput: props.output.accounts[id]
  })
)
