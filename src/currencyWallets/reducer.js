import { recycle } from '../util/recycle.js'

const ADD = 'airbitz-core-js/currencyWallet/ADD'
const UPDATE = 'airbitz-core-js/currencyWallet/UPDATE'
const SET_NAME = 'airbitz-core-js/currencyWallet/SET_NAME'
const ADD_TXS = 'airbitz-core-js/currencyWallet/transactions/UPDATE'
const SET_FILE = 'airbitz-core-js/currencyWallet/transactions/SET_FILE'
const SET_FILES = 'airbitz-core-js/currencyWallet/transactions/SET_FILES'

export function add (keyId, initialState) {
  return { type: ADD, payload: { keyId, initialState } }
}

export function update (keyId, action) {
  return { type: UPDATE, payload: { keyId, action } }
}

export function setName (keyId, name) {
  return update(keyId, { type: SET_NAME, payload: { name } })
}

export function addTxs (keyId, txs) {
  return update(keyId, { type: ADD_TXS, payload: { txs } })
}

export function setFile (keyId, txid, json) {
  return update(keyId, { type: SET_FILE, payload: { txid, json } })
}

export function setFiles (keyId, files) {
  return update(keyId, { type: SET_FILES, payload: { files } })
}

function files (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case SET_FILE: {
      const { txid, json } = payload
      const out = { ...state }
      out[txid] = json
      return out
    }
    case SET_FILES: {
      const { files } = payload
      return recycle(files, state)
    }
  }
  return state
}

/**
 * Wallet name reducer.
 */
function name (state = null, action) {
  return action.type === SET_NAME ? action.payload.name : state
}

/**
 * Transaction list reducer.
 */
function txs (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case ADD_TXS: {
      const { txs } = payload
      const out = { ...state }
      for (const tx of txs) {
        out[tx.txid] = tx
      }
      return out
    }
  }
  return state
}

/**
 * Individual wallet reducer.
 */
function currencyWallet (state, action) {
  return {
    ...state,
    files: files(state.files, action),
    name: name(state.name, action),
    txs: txs(state.txs, action)
  }
}

/**
 * Wallet list reducer.
 */
export default function currencyWallets (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case ADD: {
      const { keyId, initialState } = payload
      const out = { ...state }
      out[keyId] = currencyWallet(initialState, { type: 'setup' })
      return out
    }
    case UPDATE: {
      const { keyId, action } = payload
      if (state[keyId] != null) {
        // Only update if the wallet exists:
        const out = { ...state }
        out[keyId] = currencyWallet(state[keyId], action)
        return out
      } else {
        return state
      }
    }
  }
  return state
}
