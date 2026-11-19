/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, firebaseProjectInfo, googleProvider } from '../firebase';
import { ensureFirebaseUserInitialized } from '../utils/firebaseSync';

export type CloudSyncState = 'idle' | 'initializing' | 'synced' | 'error';

export interface FirebaseContextValue {
  firebaseUser: User | null;
  isAuthReady: boolean;
  isSigningIn: boolean;
  authError: string | null;
  cloudSyncState: CloudSyncState;
  lastCloudSyncAt: string | null;
  projectId: string;
  firestoreDatabaseId: string;
  signInWithFirebaseGoogle: () => Promise<User | null>;
  signOutFirebase: () => Promise<void>;
  setCloudSyncState: (state: CloudSyncState) => void;
  markCloudSynced: () => void;
  clearAuthError: () => void;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudSyncState, setCloudSyncState] = useState<CloudSyncState>('idle');
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);

      if (user) {
        setCloudSyncState('initializing');
        void ensureFirebaseUserInitialized(user)
          .then(() => {
            setCloudSyncState('synced');
            setLastCloudSyncAt(new Date().toISOString());
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            setAuthError(msg);
            setCloudSyncState('error');
          });
      } else {
        setCloudSyncState('idle');
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithFirebaseGoogle = useCallback(async (): Promise<User | null> => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      if (credential.user) {
        await ensureFirebaseUserInitialized(credential.user);
        setCloudSyncState('synced');
        setLastCloudSyncAt(new Date().toISOString());
      }
      return credential.user;
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Sign-in popup was closed before completing authentication.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Browser blocked the Google Sign-In popup. Please allow popups and try again.');
      } else {
        setAuthError(err?.message || 'Firebase Google Sign-In failed. Please try again.');
      }
      throw err;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOutFirebase = useCallback(async () => {
    setAuthError(null);
    await signOut(auth);
    setCloudSyncState('idle');
    setLastCloudSyncAt(null);
  }, []);

  const markCloudSynced = useCallback(() => {
    setCloudSyncState('synced');
    setLastCloudSyncAt(new Date().toISOString());
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        isAuthReady,
        isSigningIn,
        authError,
        cloudSyncState,
        lastCloudSyncAt,
        projectId: firebaseProjectInfo.projectId,
        firestoreDatabaseId: firebaseProjectInfo.firestoreDatabaseId,
        signInWithFirebaseGoogle,
        signOutFirebase,
        setCloudSyncState,
        markCloudSynced,
        clearAuthError,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside a FirebaseProvider');
  }
  return ctx;
}
