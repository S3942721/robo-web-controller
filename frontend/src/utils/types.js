export const scripts = [
    "Script 1",
    "Script 2",
    "Script 3",
    "Script 4",
    "Script 5",
    "Script 6"
]

export const profiles = [
    { name: 'LLM Profile', html: 'chatbot.html', flags: { gap_fill: true, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v1' } },
    { name: 'CityNorth Event Agenda Profile', html: 'event-agenda.html', flags: { gap_fill: false, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v2' } }
]

export const triggers = {
    'Forced Eye Contact': false,
    'Wandering': false,
    'Expressions': false,
    'Need free space for animations': false,
    'Search for new people if not interacting': false,
    'Trigger strike a pose': false,
}