import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    // Still log to console for devtools.
    console.error('App crashed:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ marginTop: 0 }}>App error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff6a41' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <p style={{ opacity: 0.8 }}>
            Open DevTools Console for the full stack trace.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

