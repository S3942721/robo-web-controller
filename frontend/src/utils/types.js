// export const scripts = {
//     "Acknowledgement of Country": "RMIT University acknowledges the people of the Woi wurrung and Boon wurrung language groups of the eastern Kulin Nation on whose unceded lands we conduct the business of the University. RMIT University respectfully acknowledges their Ancestors and Elders, past and present. RMIT also acknowledges the Traditional Custodians and their Ancestors of the lands and waters across Australia where we conduct our business",
//     "Introduce Tom Bentley": "^start(animations/Stand/Gestures/Next_1) \\\\rspd=95\\\\ Ladies and gentlemen,\nWelcome to the Cirth North Fest: Shared Future Series Showcase event! I'm Pepper, your lively event Co-MC, brought to life by the RMIT RACE Hub with the wonderful support of the CirthNorth Project.\nI'm delighted to introduce Professor Tom Bentley, our Vice President of Strategy and Community Impact. Professor Bentley's background is in public policy, working with institutions around the world since the 1990s to renew education, community and economic development by making them more inclusive and innovative.\n^start(animations/Stand/Emotions/Positive/Excited_1) Please join me in welcoming Professor Tom Bentley to the stage. ^wait(animations/Stand/Emotions/Positive/Excited_1)",
//     "Next Speaker: Joel E. Cutcher Gershenfeld": "^start(animations/Stand/Gestures/Next_1) \\\\rspd=85\\\\ The next speaker is Professor Joel E. Cutcher Gershenfeld from Brandeis University, his presentation is about How do we work together for impact at scale? What does that look like in practice?",
//     "Introduce Joel E. Cutcher Gershenfeld": "^start(animations/Stand/Gestures/You_1) \\\\rspd=90\\\\ Joel Cutcher-Gershenfeld is the Florence G. Heller Chair and Professor in the Heller School for Social Policy and Management at Brandeis University, where he Directs the Social Impact MBA Program. Joel leads research on institutional agility to address societal challenges and teaches classes on strategy, operations, and negotiations. Previously he served as a professor and dean in the School of Labor and Employment Relations at the University of Illinois, United States. Joel is an award-winning author who has co-authored or co-edited twelve books. ^start(animations/Stand/Emotions/Positive/Excited_1) Please join me in welcoming professor Gershenfeld. ^wait(animations/Stand/Emotions/Positive/Excited_1)"
// }

export const profiles = [
    { name: 'LLM Profile', html: 'chatbot.html', flags: { gap_fill: true, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v1' } },
    { name: 'CityNorth Event Agenda Profile', html: 'event-agenda-citynorth.html', flags: { gap_fill: false, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v2' } },
    { name: 'LTQ Showcase Event Agenda Profile', html: 'event-agenda-ltq.html', flags: { gap_fill: false, endpoint: 'http://ec2-13-211-94-153.ap-southeast-2.compute.amazonaws.com/v2' } }
]

const citynorth_profile_scripts = {
    "Acknowledgement of Country": "RMIT University acknowledges the people of the Woi wurrung and Boon wurrung language groups of the eastern Kulin Nation on whose unceded lands we conduct the business of the University. RMIT University respectfully acknowledges their Ancestors and Elders, past and present. RMIT also acknowledges the Traditional Custodians and their Ancestors of the lands and waters across Australia where we conduct our business",
    "Introduce Tom Bentley": "^start(animations/Stand/Gestures/Next_1) \\\\rspd=95\\\\ Ladies and gentlemen,\nWelcome to the Cirth North Fest: Shared Future Series Showcase event! I'm Pepper, your lively event Co-MC, brought to life by the RMIT RACE Hub with the wonderful support of the CirthNorth Project.\nI'm delighted to introduce Professor Tom Bentley, our Vice President of Strategy and Community Impact. Professor Bentley's background is in public policy, working with institutions around the world since the 1990s to renew education, community and economic development by making them more inclusive and innovative.\n^start(animations/Stand/Emotions/Positive/Excited_1) Please join me in welcoming Professor Tom Bentley to the stage. ^wait(animations/Stand/Emotions/Positive/Excited_1)",
    "Next Speaker: Joel E. Cutcher Gershenfeld": "^start(animations/Stand/Gestures/Next_1) \\\\rspd=85\\\\ The next speaker is Professor Joel E. Cutcher Gershenfeld from Brandeis University, his presentation is about How do we work together for impact at scale? What does that look like in practice?",
    "Introduce Joel E. Cutcher Gershenfeld": "^start(animations/Stand/Gestures/You_1) \\\\rspd=90\\\\ Joel Cutcher-Gershenfeld is the Florence G. Heller Chair and Professor in the Heller School for Social Policy and Management at Brandeis University, where he Directs the Social Impact MBA Program. Joel leads research on institutional agility to address societal challenges and teaches classes on strategy, operations, and negotiations. Previously he served as a professor and dean in the School of Labor and Employment Relations at the University of Illinois, United States. Joel is an award-winning author who has co-authored or co-edited twelve books. ^start(animations/Stand/Emotions/Positive/Excited_1) Please join me in welcoming professor Gershenfeld. ^wait(animations/Stand/Emotions/Positive/Excited_1)"
}

const LTQ_profile_scripts = {
    "Acknowledgement of Country": "RMIT University acknowledges the people of the Woi wurrung and Boon wurrung language groups of the eastern Kulin Nation on whose unceded lands we conduct the business of the University. RMIT University respectfully acknowledges their Ancestors and Elders, past and present. RMIT also acknowledges the Traditional Custodians and their Ancestors of the lands and waters across Australia where we conduct our business",
    "Next Speaker: Danny Liu": "^start(animations/Stand/Gestures/Next_1) \\\\rspd=85\\\\ The next speaker is Professor Danny Liu from University of Sydney, his presentation is about Getting the most out of AI in STEM Education.",
    "Introduce Danny Liu": "^start(animations/Stand/Gestures/You_1) \\\\rspd=85\\\\ Danny is a molecular biologist by training, programmer by night, researcher and academic developer by day, and educator at heart. A multiple international and national teaching award winner, he works at the confluence of artificial intelligence, learning analytics, student engagement, educational technology, and professional development and leadership. He is a Professor of Educational Technologies in the DVC Education Portfolio at the University of Sydney, co-chairs the University's AI in Education working group, and leads the Cogniti.ai initiative that puts educators in the driver's seat of AI. ^start(animations/Stand/Emotions/Positive/Excited_1) Please join me in welcoming professor Liu. ^wait(animations/Stand/Emotions/Positive/Excited_1)",
    "Next Speaker: Bonnie Amelia Dean": "^start(animations/Stand/Gestures/Next_1) \\\\rspd=85\\\\ The next speaker is Associate Professor Bonnie Amelia Dean from University of Wollongong, her presentation topic is Bridging classroom and career: Strengthening student employability through work-integrated learning.",
    "Introduce Bonnie Amelia Dean": "^start(animations/Stand/Gestures/You_1) \\\\rspd=95\\\\ Associate Professor Bonnie Amelia Dean serves as the Head of Academic Development & Recognition at the University of Wollongong. In this role, she strategically shapes the academic landscape through governance, collaborative co-design, and professional development. Bonnie focuses on enhancing student learning and experiences by supporting faculty in designing practical, employability-driven curricula. She seeks to empower educational leaders to strategically navigate and excel throughout their academic careers. A Senior Fellow of Advance HE (UK, Higher Education Academy), in 2023, Bonnie won a national award, an Australian Awards for University Teaching (AAUT) citation, for her impact on student employabilty through educator development and governance. ^start(animations/Stand/Emotions/Positive/Excited_1) Please join me in welcoming professor Dean. ^wait(animations/Stand/Emotions/Positive/Excited_1)",
    "Thank you message": "On behalf of Professor Angela Carbone, I would like to extend a warm thank you to all of you for attending the Learning and Teaching Showcase today.\nYour participation and insights have been invaluable, and we are grateful for the time and effort you have dedicated to making this event a success. Your commitment to enhancing learning and teaching is truly commendable.\nA special thanks goes to everyone who contributed to organising this event, ensuring everything ran smoothly.\nProfessor Carbone is eager to continue these important conversations, so please feel free to share any further thoughts or ideas you may have.\nThank you once again for your engagement and collaboration. We look forward to the exciting advancements we will achieve together.\nSafe travels and have a wonderful day!"
}

export function getScript(profile) {
    switch(profile) {
        case 'CityNorth Event Agenda Profile':
            return citynorth_profile_scripts;
        case 'LTQ Showcase Event Agenda Profile':
            return LTQ_profile_scripts;
        default:
            return {};
    }
}

export const triggers = {
    'Forced Eye Contact': false,
    'Wandering': false,
    'Expressions': false,
    'Need free space for animations': false,
    'Search for new people if not interacting': false,
    'Trigger strike a pose': false,
    'Speech Recognition': true
}

// Bridging classroom and career: Strengthening student employability through work-integrated learning