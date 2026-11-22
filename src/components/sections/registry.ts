// Page-builder registry: section type → { label (Turkish, for the panel), schema, defaults, Component }.
// Schemas and labels live in ./schemas so the panel can use them without importing components.
import type { ReactNode } from "react";
import type { z } from "zod";
import B2bCta from "./B2bCta";
import ContactForm from "./ContactForm";
import ContactInfo from "./ContactInfo";
import Faq from "./Faq";
import FeaturedProducts from "./FeaturedProducts";
import Hero from "./Hero";
import ImageBanner from "./ImageBanner";
import LegalDocument from "./LegalDocument";
import LifestyleGallery from "./LifestyleGallery";
import Newsletter from "./Newsletter";
import Packaging from "./Packaging";
import QuoteForm from "./QuoteForm";
import RichText from "./RichText";
import ScentShowcase from "./ScentShowcase";
import SampleCta from "./SampleCta";
import SampleRequestForm from "./SampleRequestForm";
import Story from "./Story";
import VideoSection from "./VideoSection";
import { sectionMeta, type SectionType } from "./schemas";
import type { SectionProps } from "./ui";

export type SectionComponent<T> = (props: SectionProps<T>) => ReactNode | Promise<ReactNode>;

export type SectionDefinition<S extends z.ZodType = z.ZodType> = {
  label: string;
  schema: S;
  defaults: z.input<S>;
  Component: SectionComponent<z.output<S>>;
};

type Registry = { [K in SectionType]: SectionDefinition<(typeof sectionMeta)[K]["schema"]> };

export const sectionRegistry: Registry = {
  hero: { ...sectionMeta.hero, Component: Hero },
  scent_showcase: { ...sectionMeta.scent_showcase, Component: ScentShowcase },
  featured_products: { ...sectionMeta.featured_products, Component: FeaturedProducts },
  packaging: { ...sectionMeta.packaging, Component: Packaging },
  lifestyle_gallery: { ...sectionMeta.lifestyle_gallery, Component: LifestyleGallery },
  b2b_cta: { ...sectionMeta.b2b_cta, Component: B2bCta },
  sample_cta: { ...sectionMeta.sample_cta, Component: SampleCta },
  story: { ...sectionMeta.story, Component: Story },
  newsletter: { ...sectionMeta.newsletter, Component: Newsletter },
  rich_text: { ...sectionMeta.rich_text, Component: RichText },
  image_banner: { ...sectionMeta.image_banner, Component: ImageBanner },
  faq: { ...sectionMeta.faq, Component: Faq },
  legal_document: { ...sectionMeta.legal_document, Component: LegalDocument },
  contact_info: { ...sectionMeta.contact_info, Component: ContactInfo },
  contact_form: { ...sectionMeta.contact_form, Component: ContactForm },
  quote_form: { ...sectionMeta.quote_form, Component: QuoteForm },
  sample_request_form: { ...sectionMeta.sample_request_form, Component: SampleRequestForm },
  video: { ...sectionMeta.video, Component: VideoSection },
};

export { sectionMeta, sectionTypes, isSectionType, type SectionType } from "./schemas";
