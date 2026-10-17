import './globals.css'
export const metadata = { title: '학원 출결' }
export const viewport = { width: 'device-width', initialScale: 1 }
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>
}
