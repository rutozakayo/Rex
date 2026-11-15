import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'DARKNOTE CONTROL CENTER', description:'Secure control center for an existing Pterodactyl-hosted bot.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
