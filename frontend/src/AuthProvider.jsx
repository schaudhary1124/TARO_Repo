import React, { createContext, useContext, useEffect, useState } from 'react';
import { me, login as apiLogin, register as apiRegister } from './api';

const AuthCtx = createContext(null);
export function useAuth() {
  return useContext(AuthCtx);
}

const TOKEN_KEY = 'taro_token';

export default function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!token);

  // On mount or when token updates: try to fetch /auth/me
  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    setLoading(true);
    me(token)
      .then(u => setUser({ ...u, guest: false }))
      .catch(() => {
        setUser(null);
        setToken('');
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const value = {
    token,
    user,
    loading,

    async login(email, password) {
      // First login using backend auth
      const r = await apiLogin(email, password);
      const authToken = r.token;
      // Save token locally
      localStorage.setItem(TOKEN_KEY, authToken);
      setToken(authToken);

      // Fetch user info immediately and update state
      const userData = await me(authToken);
    setUser({ ...userData, guest: false });


      return r;
    },

    async register(email, password) {
      // First try to register
      const r = await apiRegister(email, password);
      const authToken = r.token;

      // Save token locally
      localStorage.setItem(TOKEN_KEY, authToken);
      setToken(authToken);

      // Fetch user info immediately and update state
      const userData = await me(authToken);
      setUser(userData);

      return r;
    },

    logout() {
      localStorage.removeItem(TOKEN_KEY);
      setToken('');
      setUser(null);
    }
  };

  return (
    <AuthCtx.Provider value={value}>
      {children}
    </AuthCtx.Provider>
  );
}
