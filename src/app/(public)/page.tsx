import {
  AiSafety,
  Audiences,
  Categories,
  FinalCallToAction,
  Hero,
  HowItWorks,
  ProductPreview,
} from "./_components/landing-sections";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Categories />
      <HowItWorks />
      <ProductPreview />
      <AiSafety />
      <Audiences />
      <FinalCallToAction />
    </>
  );
}
