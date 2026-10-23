import type { ComplaintCategory } from "@/features/complaints/categories";

/**
 * Fictional maintenance complaints (master plan §1: synthetic data only). The expected
 * category is the label a human would assign; Phase 4 extends this set for the AI evaluation.
 */
export interface SyntheticComplaint {
  readonly title: string;
  readonly description: string;
  readonly building: string;
  readonly room?: string;
  readonly expectedCategory: ComplaintCategory;
}

export const SYNTHETIC_COMPLAINTS: readonly SyntheticComplaint[] = [
  {
    title: "Ceiling fan not working",
    description: "The ceiling fan in the lecture hall stopped spinning this morning.",
    building: "Block C",
    room: "214",
    expectedCategory: "electrical",
  },
  {
    title: "Flickering lights in corridor",
    description: "Tube lights on the second floor corridor flicker constantly after 5 pm.",
    building: "Engineering Block",
    expectedCategory: "electrical",
  },
  {
    title: "Power socket sparking",
    description: "The wall socket next to the window sparks when a charger is plugged in.",
    building: "Hostel A",
    room: "12",
    expectedCategory: "electrical",
  },
  {
    title: "Projector shows no signal",
    description: "The classroom projector says no signal with every laptop we tried.",
    building: "Block B",
    room: "105",
    expectedCategory: "it_equipment",
  },
  {
    title: "Lab computers will not boot",
    description: "Four desktop computers in the lab are stuck on a black screen at start-up.",
    building: "Computer Centre",
    room: "Lab 3",
    expectedCategory: "it_equipment",
  },
  {
    title: "Wi-Fi drops in library",
    description: "Campus Wi-Fi disconnects every few minutes on the library's upper floor.",
    building: "Library",
    expectedCategory: "it_equipment",
  },
  {
    title: "Printer jams on every page",
    description: "The shared printer jams after every single page and shows a paper error.",
    building: "Admin Block",
    room: "Ground floor",
    expectedCategory: "it_equipment",
  },
  {
    title: "Leaking tap in washroom",
    description: "The tap in the ground floor washroom keeps dripping even when closed tightly.",
    building: "Block A",
    expectedCategory: "plumbing",
  },
  {
    title: "Water cooler leaking",
    description: "Water is pooling under the drinking water cooler near the stairs.",
    building: "Science Block",
    expectedCategory: "plumbing",
  },
  {
    title: "Blocked drain in kitchen",
    description: "The sink drain in the staff kitchen is blocked and water will not go down.",
    building: "Faculty Block",
    room: "Kitchen",
    expectedCategory: "plumbing",
  },
  {
    title: "Low water pressure in showers",
    description: "Showers on the third floor have almost no water pressure in the mornings.",
    building: "Hostel B",
    expectedCategory: "plumbing",
  },
  {
    title: "Broken chair in classroom",
    description: "One of the chairs in the front row has a cracked seat and wobbles badly.",
    building: "Block C",
    room: "201",
    expectedCategory: "furniture",
  },
  {
    title: "Desk drawer stuck",
    description: "The drawer of the reception desk is jammed shut and will not open.",
    building: "Admin Block",
    expectedCategory: "furniture",
  },
  {
    title: "Whiteboard falling off wall",
    description: "The whiteboard in the seminar room is loose and tilting away from the wall.",
    building: "Block B",
    room: "Seminar 2",
    expectedCategory: "furniture",
  },
  {
    title: "Library shelf collapsed",
    description: "A shelf in the reference section collapsed and books are on the floor.",
    building: "Library",
    room: "Reference",
    expectedCategory: "furniture",
  },
  {
    title: "Overflowing bins near cafeteria",
    description: "The rubbish bins outside the cafeteria are overflowing and attracting insects.",
    building: "Cafeteria",
    expectedCategory: "sanitation",
  },
  {
    title: "Washroom not cleaned",
    description: "The second floor washroom has not been cleaned for two days and smells bad.",
    building: "Engineering Block",
    expectedCategory: "sanitation",
  },
  {
    title: "No soap in dispensers",
    description: "All soap dispensers in the hostel washrooms have been empty since Monday.",
    building: "Hostel A",
    expectedCategory: "sanitation",
  },
  {
    title: "Parking barrier stuck open",
    description: "The barrier at the staff parking entrance stays up and no longer closes.",
    building: "Main Gate",
    expectedCategory: "other",
  },
  {
    title: "Notice board glass cracked",
    description: "The glass cover of the department notice board has a long crack across it.",
    building: "Arts Block",
    expectedCategory: "other",
  },
];
