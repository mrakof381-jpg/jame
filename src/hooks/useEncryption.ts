import { useState, useEffect, useCallback } from 'react';
import { generateKey, exportKey, importKey, encryptMessage, decryptMessage } from '../utils/crypto';

const KEYS_STORAGE_KEY = 'pulse_encryption_keys';

interface StoredKeys {
  [chatId: string]: string;
}

export function useEncryption() {
  const [keys, setKeys] = useState<Record<string, CryptoKey>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(KEYS_STORAGE_KEY);
    if (stored) {
      const parsed: StoredKeys = JSON.parse(stored);
      Promise.all(
        Object.entries(parsed).map(async ([chatId, keyData]) => {
          const key = await importKey(keyData);
          return [chatId, key] as [string, CryptoKey];
        })
      ).then(loaded => {
        setKeys(Object.fromEntries(loaded));
        setReady(true);
      });
    } else {
      setReady(true);
    }
  }, []);

  const getOrCreateKey = useCallback(async (chatId: string): Promise<CryptoKey> => {
    let key = keys[chatId];
    if (!key) {
      key = await generateKey();
      const exported = await exportKey(key);
      const stored = localStorage.getItem(KEYS_STORAGE_KEY);
      const storedKeys: StoredKeys = stored ? JSON.parse(stored) : {};
      storedKeys[chatId] = exported;
      localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(storedKeys));
      setKeys(prev => ({ ...prev, [chatId]: key! }));
    }
    return key;
  }, [keys]);

  const encrypt = useCallback(async (text: string, chatId: string): Promise<string> => {
    const key = await getOrCreateKey(chatId);
    return await encryptMessage(text, key);
  }, [getOrCreateKey]);

  const decrypt = useCallback(async (ciphertext: string, chatId: string): Promise<string> => {
    let key = keys[chatId];
    if (!key) {
      const stored = localStorage.getItem(KEYS_STORAGE_KEY);
      if (stored) {
        const parsed: StoredKeys = JSON.parse(stored);
        if (parsed[chatId]) {
          key = await importKey(parsed[chatId]);
          setKeys(prev => ({ ...prev, [chatId]: key! }));
        }
      }
    }
    if (!key) {
      key = await getOrCreateKey(chatId);
    }
    try {
      return await decryptMessage(ciphertext, key);
    } catch {
      return ciphertext;
    }
  }, [keys, getOrCreateKey]);

  return { encrypt, decrypt, ready };
}
