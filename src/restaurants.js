// Mock restaurants provider for prototype. Can later integrate real Places API.
const MOCK_BY_CUISINE = {
  italian: ['Italian Bistro', 'Trattoria Roma', 'Pasta House'],
  sushi: ['Sushi Zen', 'Ocean Sashimi', 'Nigiri Bar'],
  mexican: ['Casa Mexicana', 'El Camino Grill', 'Taqueria Viva'],
  thai: ['Thai Orchid', 'Bangkok Spice', 'Curry Leaf'],
  indian: ['Spice Route', 'Curry Palace', 'Tandoori Oven']
};

export function getMockRestaurants (cuisine) {
  if (!cuisine) return ['Local Eatery', 'Central Diner', 'City Grill'];
  return MOCK_BY_CUISINE[cuisine.toLowerCase()] || [cuisine + ' Place 1', cuisine + ' Place 2'];
}
