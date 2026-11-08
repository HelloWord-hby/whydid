/**
 * Provider registry. To add a new kind of card data, write a provider
 * with defineProvider() and list it here; cards then reference it by name
 * from whydid.boards.yaml.
 */
import { MODEL_PROVIDERS } from './model.js';
import { SEMANTIC_PROVIDERS } from './semantic.js';
import { type AnyProvider } from './types.js';

export const PROVIDERS: Record<string, AnyProvider> = {
  ...MODEL_PROVIDERS,
  ...SEMANTIC_PROVIDERS,
};

export function getProvider(name: string): AnyProvider {
  const p = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : undefined;
  if (!p) {
    throw new Error(`Unknown provider "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return p;
}
