import { Component } from "react";

// A render-time throw anywhere below this boundary used to unmount the whole app,
// leaving a white screen that even "Change area" couldn't recover from (App itself
// was gone). Now we catch it, show the error, and offer a recover path.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("UI crash:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/95 p-6">
        <div className="max-w-lg text-center">
          <div className="text-sm font-semibold text-red-600 mb-2">Something broke in the map view</div>
          <pre className="text-[11px] text-left bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-48 text-gray-700">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 text-xs rounded px-3 py-1.5 bg-gray-800 text-white"
          >
            Dismiss and retry
          </button>
        </div>
      </div>
    );
  }
}
