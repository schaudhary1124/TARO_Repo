import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import ErrorBoundary from './ErrorBoundary'
import AuthProvider from './AuthProvider'

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>
)
