import {
  AiSafety,
  Audiences,
  Categories,
  FinalCallToAction,
  Hero,
  HowItWorks,
} from "./_components/landing-sections";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Categories />
      <HowItWorks />
      <Audiences />
      <AiSafety />
      <FinalCallToAction />
    </>
  );
}
