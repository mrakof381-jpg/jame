import { generateKey, exportKey, importKey, encryptMessage, decryptMessage } from '../utils/crypto';

const KEYS_STORAGE_KEY = 'pulse_chat_keys';

class EncryptionManager {
  private keys: Map<string, CryptoKey> = new Map();
  private ready = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init() {
    try {
      const stored = localStorage.getItem(KEYS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const entries = await Promise.all(
          Object.entries(parsed).map(async ([chatId, keyData]: [string, unknown]) => {
            const key = await importKey(keyData as string);
            return [chatId, key] as [string, CryptoKey];
          })
        );
        entries.forEach(([chatId, key]) => this.keys.set(chatId, key));
      }
    } catch (e) {
      console.error('Failed to load encryption keys:', e);
    }
    this.ready = true;
  }

  async waitReady() {
    await this.initPromise;
  }

  isReady() {
    return this.ready;
  }

  async getKey(chatId: string): Promise<CryptoKey> {
    await this.waitReady();
    
    let key = this.keys.get(chatId);
    if (!key) {
      key = await generateKey();
      const exported = await exportKey(key);
      const stored = localStorage.getItem(KEYS_STORAGE_KEY);
      const storedKeys = stored ? JSON.parse(stored) : {};
      storedKeys[chatId] = exported;
      localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(storedKeys));
      this.keys.set(chatId, key);
    }
    return key;
  }

  async encrypt(text: string, chatId: string): Promise<string> {
    const key = await this.getKey(chatId);
    return await encryptMessage(text, key);
  }

  async decrypt(ciphertext: string, chatId: string): Promise<string> {
    try {
      const key = await this.getKey(chatId);
      return await decryptMessage(ciphertext, key);
    } catch {
      return ciphertext;
    }
  }

  hasKey(chatId: string): boolean {
    return this.keys.has(chatId);
  }
}

export const encryptionManager = new EncryptionManager();
