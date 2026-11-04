import {
  AiSafety,
  Audiences,
  Categories,
  FinalCallToAction,
  Hero,
  HowItWorks,
  ProductPreview,
} from "./_components/landing-sections";
import { ScrollReveal } from "./_components/scroll-reveal";

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
      <ScrollReveal />
    </>
  );
}
