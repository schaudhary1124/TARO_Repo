import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('React crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <pre style={{ padding: 20, color: 'red', whiteSpace: 'pre-wrap' }}>
          💥 {String(this.state.error.stack || this.state.error)}
        </pre>
      );
    }

    return this.props.children;
  }
}
