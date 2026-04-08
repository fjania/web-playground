#!/usr/bin/env python3
"""Process movie scripts into word frequency datasets for the word cloud."""

import re
import json
from collections import Counter
from pathlib import Path

STOP_WORDS = {
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','it','this','that','are','was','were','be','been','being','have',
    'has','had','do','does','did','will','would','could','should','may','might',
    'shall','can','not','no','so','if','then','than','too','very','just','about',
    'up','out','its','my','your','his','her','our','their','we','you','he','she',
    'they','i','me','him','us','them','what','which','who','whom','how','when',
    'where','why','all','each','every','both','few','more','most','other','some',
    'such','only','own','same','as','into','also','over','after','before','between',
    'there','here','now','back','down','still','through','like','even','these',
    'those','been','much','well','off','way','get','got','goes','going','gone',
    'come','came','take','took','taken','make','made','give','gave','go','see',
    'seen','say','said','tell','told','know','knew','known','think','thought',
    'look','looked','want','wanted','turn','turned','right','left','around',
    'again','away','never','always','really','already','another','something',
    'anything','everything','nothing','someone','anyone','everyone','enough',
    'things','thing','being','let','put','keep','kept','while','until','yet',
    'ever','seems','seem','maybe','though','without','sure','okay','yeah','yes',
    'hey','oh','well','uh','um','gonna','gotta','wanna','dont','doesnt','didnt',
    'cant','wont','shouldnt','wouldnt','couldnt','isnt','arent','wasnt','werent',
    'thats','whats','hes','shes','its','theyre','youre','were','ive','youve',
    'weve','theyve','ill','youll','hell','shell','theyll','wed','youd','hed',
    'shed','theyd','im','heres','theres','wheres','whos','ones','two','three',
    'long','many','new','old','first','last','next','little','big','much',
    'own','good','great','little','dont','im','hes','shes','youre',
    # Contractions that aren't interesting in word clouds
    "don't","i'm","it's","he's","she's","you're","we're","they're","i'll",
    "that's","what's","can't","didn't","doesn't","isn't","aren't","wasn't",
    "weren't","won't","wouldn't","couldn't","shouldn't","ain't","let's",
    "there's","here's","who's","hadn't","haven't","hasn't",
    # More screenplay noise
    "young","woman","pov","toward","toward","front","side","inside",
    "across","voice","above","under","floor","wall","window","table",
}

# Screenplay-specific noise
SCRIPT_NOISE = {
    'int','ext','cont','contd','vo','os','cut','fade','dissolve',
    'angle','close','closeup','wide','pan','tracking','shot',
    'continued','continues','pause','beat','scene','takes','looks',
    'turns','walks','moves','sits','stands','opens','closes','pulls',
    'puts','picks','hands','runs','stops','starts','holds','points',
    'nods','shakes','stares','watches','enters','exits','leaves',
    'crosses','reaches','grabs','drops','throws','begins','gets',
    'sees','comes','camera','screen','title','credits','end',
    'morning','night','day','later','moments','moment','suddenly',
    'slowly','quickly','intercut','montage','series','shots',
    'super','smash','match','reverse','insert','omit','omitted',
    'revised','draft','page','script','screenplay',
}

SCRIPTS = {
    'pulp-fiction': {
        'title': 'Pulp Fiction',
        'desc': 'Most distinctive words from Tarantino\'s 1994 screenplay',
        'metric': 'occurrences',
        'unit': '',
    },
    'jurassic-park': {
        'title': 'Jurassic Park',
        'desc': 'Word frequencies from Crichton & Koepp\'s dinosaur thriller',
        'metric': 'occurrences',
        'unit': '',
    },
    'princess-bride': {
        'title': 'The Princess Bride',
        'desc': 'Word frequencies from Goldman\'s beloved fairy tale screenplay',
        'metric': 'occurrences',
        'unit': '',
    },
    'shawshank-redemption': {
        'title': 'The Shawshank Redemption',
        'desc': 'Word frequencies from Darabont\'s prison drama screenplay',
        'metric': 'occurrences',
        'unit': '',
    },
    'big-lebowski': {
        'title': 'The Big Lebowski',
        'desc': 'Word frequencies from the Coen Brothers\' cult classic',
        'metric': 'occurrences',
        'unit': '',
    },
    'caddyshack': {
        'title': 'Caddyshack',
        'desc': 'Word frequencies from Ramis, Kenney & Doyle-Murray\'s golf comedy',
        'metric': 'occurrences',
        'unit': '',
    },
}

def process_script(filepath):
    text = Path(filepath).read_text(encoding='utf-8', errors='ignore')

    # Remove screenplay formatting
    # Remove scene headings (INT. / EXT. lines)
    text = re.sub(r'^(INT\.|EXT\.|INT/EXT\.).*$', '', text, flags=re.MULTILINE)
    # Remove transition cues
    text = re.sub(r'^(CUT TO|FADE IN|FADE OUT|DISSOLVE TO|SMASH CUT|MATCH CUT).*$', '', text, flags=re.MULTILINE)
    # Remove parentheticals like (beat), (continuing), (V.O.), (O.S.)
    text = re.sub(r'\([^)]*\)', '', text)
    # Remove CONT'D, (CONT'D), V.O., O.S.
    text = re.sub(r"CONT'?D", '', text)
    text = re.sub(r'\bV\.O\.\b', '', text)
    text = re.sub(r'\bO\.S\.\b', '', text)

    # Tokenize
    text = text.lower()
    tokens = re.findall(r"[a-z']+", text)

    # Filter
    all_noise = STOP_WORDS | SCRIPT_NOISE
    counts = Counter()
    for token in tokens:
        # Strip leading/trailing apostrophes
        word = token.strip("'")
        if len(word) < 3:
            continue
        if word in all_noise:
            continue
        # Skip words that are ALL CAPS character names (already lowered, but
        # check if the original was likely a character heading — these tend
        # to be single words repeated many times)
        counts[word] += 1

    # Take top 100
    top = counts.most_common(100)
    return [{'text': word, 'value': count} for word, count in top]


def main():
    scripts_dir = Path(__file__).parent

    print("// Movie script datasets — paste into datasets.js\n")

    for key, meta in SCRIPTS.items():
        filepath = scripts_dir / f"{key}.txt"
        if not filepath.exists():
            print(f"// MISSING: {filepath}")
            continue

        words = process_script(filepath)

        # Print dataset
        print(f"  {key.replace('-', '_')}: [")
        for w in words:
            escaped = w['text'].replace("'", "\\'")
            print(f"    {{text:'{escaped}',value:{w['value']}}},")
        print(f"  ],")
        print()

    # Print metadata
    print("\n// DATASET_META entries:\n")
    for key, meta in SCRIPTS.items():
        js_key = key.replace('-', '_')
        print(f"  {js_key}: {{ title: \"{meta['title']}\", desc: '{meta['desc']}', metric: '{meta['metric']}', unit: '{meta['unit']}' }},")

    # Print option elements
    print("\n// <option> elements:\n")
    for key, meta in SCRIPTS.items():
        js_key = key.replace('-', '_')
        print(f'  <option value="{js_key}">{meta["title"]}</option>')


if __name__ == '__main__':
    main()
