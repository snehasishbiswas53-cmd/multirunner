export const metadata = {
  title: 'Cele Failover Dashboard',
  description: 'Cele selfbot — 4-instance Render failover monitor',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
