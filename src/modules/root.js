// @flow

import { type Store, type StoreEnhancer, compose, createStore } from 'redux'
import { type ReduxProps, attachPixie, filterPixie } from 'redux-pixies'
import { emit } from 'yaob'

import { type EdgeContextOptions, type EdgeIo } from '../types/types.js'
import { type RootAction } from './actions.js'
import { type RootOutput, type RootProps, rootPixie } from './root-pixie.js'
import { type RootState, reducer } from './root-reducer.js'

/**
 * The root of the entire core state machine.
 * Contains io resources, context options, Redux store,
 * and tree of background workers. Everything that happens, happens here.
 */
export type CoreRoot = {
  redux: Store<RootState, RootAction>,

  // Pixies:
  output: RootOutput,
  destroyPixie?: () => void
}

let allDestroyPixies: Array<() => void> = []

const composeEnhancers =
  typeof window === 'object' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'core' })
    : compose

function nop () {}

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export function makeCoreRoot (io: EdgeIo, opts: EdgeContextOptions) {
  const onErrorDefault = (error, name) => io.console.error(name, error)

  const {
    apiKey,
    appId = '',
    authServer = 'https://auth.airbitz.co/api',
    callbacks = {},
    changellyInit = void 0,
    hideKeys = false,
    plugins = [],
    shapeshiftKey = void 0,
    changeNowKey = void 0
  } = opts
  const { onError = onErrorDefault, onExchangeUpdate = nop } = callbacks

  if (apiKey == null) {
    throw new Error('No API key provided')
  }

  const enhancers: StoreEnhancer<RootState, RootAction> = composeEnhancers()

  const output: any = {}
  const coreRoot: CoreRoot = {
    redux: createStore(reducer, enhancers),
    output
  }
  coreRoot.redux.dispatch({
    type: 'INIT',
    payload: { apiKey, appId, authServer, hideKeys }
  })

  coreRoot.destroyPixie = attachPixie(
    coreRoot.redux,
    filterPixie(
      rootPixie,
      (props: ReduxProps<RootState, RootAction>): RootProps => ({
        ...props,
        io,
        onError: error => {
          onError(error)
          if (coreRoot.output.context && coreRoot.output.context.api) {
            emit(coreRoot.output.context.api, 'error', error)
          }
        },
        onExchangeUpdate,
        plugins,
        shapeshiftKey,
        changellyInit,
        changeNowKey
      })
    ),
    e => console.error(e),
    output => (coreRoot.output = output)
  )
  allDestroyPixies.push(coreRoot.destroyPixie)

  return coreRoot
}

/**
 * We use this for unit testing, to kill all core contexts.
 */
export function destroyAllContexts () {
  for (const destroyPixie of allDestroyPixies) {
    destroyPixie()
  }
  allDestroyPixies = []
}
