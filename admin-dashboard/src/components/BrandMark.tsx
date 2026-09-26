export function BrandMark() {
  return (
    <div className="command-mark">
      <span className="brand-image-frame" aria-hidden="true">
        <img src="/logo.png" alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
      </span>
      <strong>Mamdani</strong>
    </div>
  );
}

export function Auth0Mark() {
  return (
    <svg className="auth0-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.1 18.9 4.3 20.5 11 16 17.9 12 21.8 8 17.9 3.5 11 5.1 4.3 12 2.1Zm0 4.2-1.8 5.5-4.6 3.3 5.7-.1 4.6 3.3-1.8-5.4 1.8-5.4-4.6 3.2L12 6.3Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
