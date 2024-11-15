export const scripts = {
    "Acknowledgement of Country": "RMIT University acknowledges the people of the Woi wurrung and Boon wurrung language groups of the eastern Kulin Nation on whose unceded lands we conduct the business of the University. RMIT University respectfully acknowledges their Ancestors and Elders, past and present. RMIT also acknowledges the Traditional Custodians and their Ancestors of the lands and waters across Australia where we conduct our business",
    "Introduce Tom Bentley": "^start(next) \\\\rspd=95\\\\ Ladies and gentlemen,\nWelcome to the Cirth North Fest: Shared Future Series Showcase event! I'm Pepper, your lively event Co-MC, brought to life by the RMIT RACE Hub with the wonderful support of the CirthNorth Project.\nI'm delighted to introduce Professor Tom Bentley, our Vice President of Strategy and Community Impact. Professor Bentley's background is in public policy, working with institutions around the world since the 1990s to renew education, community and economic development by making them more inclusive and innovative.\n^start(clap) Please join me in welcoming Professor Tom Bentley to the stage. ^wait(clap)",
    "Next Speaker: Joel E. Cutcher Gershenfeld": "^start(next) \\\\rspd=85\\\\ The next speaker is Professor Joel E. Cutcher Gershenfeld from Brandeis University, his presentation is about How do we work together for impact at scale? What does that look like in practice?",
    "Introduce Joel E. Cutcher Gershenfeld": "^start(you) \\\\rspd=90\\\\ Joel Cutcher-Gershenfeld is the Florence G. Heller Chair and Professor in the Heller School for Social Policy and Management at Brandeis University, where he Directs the Social Impact MBA Program. Joel leads research on institutional agility to address societal challenges and teaches classes on strategy, operations, and negotiations. Previously he served as a professor and dean in the School of Labor and Employment Relations at the University of Illinois, United States. Joel is an award-winning author who has co-authored or co-edited twelve books. ^start(clap) Please join me in welcoming professor Gershenfeld. ^wait(clap)"
}

export const profiles = [
    { name: 'LLM Profile', html: 'chatbot.html', flags: { gap_fill: true, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v1' } },
    { name: 'CityNorth Event Agenda Profile', html: 'event-agenda-citynorth.html', flags: { gap_fill: false, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v2' } }
]

export const triggers = {
    'Forced Eye Contact': false,
    'Wandering': false,
    'Expressions': false,
    'Need free space for animations': false,
    'Search for new people if not interacting': false,
    'Trigger strike a pose': false,
}