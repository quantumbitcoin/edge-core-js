import { encrypt, hmacSha256 } from '../crypto/crypto.js'
import { base16, base64, utf8 } from '../util/encoding.js'

/**
 * Returns the first keyInfo with a matching type.
 */
export function findFirstKey (keyInfos, type) {
  return keyInfos.find(info => info.type === type)
}

export function makeAccountType (appId) {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

/**
 * Assembles the key metadata structure that is encrypted within a keyBox.
 * @param idKey Used to derive the wallet id. It's usually `dataKey`.
 */
export function makeKeyInfo (type, keys, idKey) {
  return {
    id: base64.stringify(hmacSha256(utf8.parse(type), idKey)),
    type,
    keys
  }
}

/**
 * Makes keys for accessing an encrypted Git repo.
 */
export function makeStorageKeyInfo (io, type, keys = {}) {
  if (keys.dataKey == null) keys.dataKey = base64.stringify(io.random(32))
  if (keys.syncKey == null) keys.syncKey = base64.stringify(io.random(20))

  return makeKeyInfo(type, keys, base64.parse(keys.dataKey))
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit (io, login, ...keyInfos) {
  const keyBoxes = keyInfos.map(info =>
    encrypt(io, utf8.parse(JSON.stringify(info)), login.loginKey)
  )
  const newSyncKeys = keyInfos
    .filter(info => info.keys.syncKey != null)
    .map(info => base16.stringify(base64.parse(info.keys.syncKey)))

  return {
    serverPath: '/v2/login/keys',
    server: { keyBoxes, newSyncKeys },
    stash: { keyBoxes },
    login: { keyInfos },
    loginId: login.loginId
  }
}