export const metadata = {
  title: "SLVR — Grid Mining on PulseChain",
  description: "Stake PLS on a 25-square grid. A drand beacon picks the winner. Winners split the pot and mine SLVR.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
