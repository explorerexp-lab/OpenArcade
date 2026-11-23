import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, type Firestore } from 'firebase/firestore';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

let appInstance: FirebaseApp | null = null;
export let db!: Firestore;
export let auth!: Auth;
export const googleProvider = new GoogleAuthProvider();
let firebaseReady = false;
const readyListeners = new Set<() => void>();

export function isFirebaseReady(): boolean {
  return firebaseReady;
}

export function onFirebaseReady(cb: () => void): () => void {
  if (firebaseReady) {
    cb();
    return () => {};
  }
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

/**
 * Loads public Firebase web configuration at runtime from the server (/api/firebase-config)
 * so no API keys are statically imported or baked into client source files or JS bundles.
 */
export async function initFirebase(): Promise<void> {
  if (appInstance) return;
  try {
    const res = await fetch('/api/firebase-config', { cache: 'no-store' });
    if (!res.ok) {
      return;
    }
    const config = (await res.json()) as FirebaseWebConfig;
    if (!config.apiKey || !config.projectId || !config.appId) {
      return;
    }

    appInstance = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
    });
    db = getFirestore(appInstance, config.firestoreDatabaseId);
    auth = getAuth(appInstance);
    firebaseReady = true;
    for (const listener of readyListeners) {
      listener();
    }
    readyListeners.clear();
    void testConnection();
  } catch {
    // Graceful local-only mode if backend config is temporarily unreachable
    firebaseReady = false;
  }
}
