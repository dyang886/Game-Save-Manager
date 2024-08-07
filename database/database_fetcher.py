import json
import logging
import os
import sqlite3

import gevent.timeout
import mwparserfromhell
import requests
from steam.client import SteamClient

WIKI_API_URL = "https://www.pcgamingwiki.com/w/api.php"
RELEVANT_CATEGORIES = ["Category:Games", "Category:Emulators"]

open('./database/database_fetcher.log', 'w').close()
logging.basicConfig(
    filename='./database/database_fetcher.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    encoding='utf-8'
)

class DatabaseFetcher:
    def __init__(self):
        self.conn = sqlite3.connect('./database/database.db')
        self.create_tables()
        self.client = requests.Session()
    
    def fetch_all_category_members(self):
        cnt = 0
        for category in RELEVANT_CATEGORIES:
            continue_param = {}
            continue_param = {'cmcontinue': 'page|e6a8aae689abe5a4a9e4b88be4b98be4b887e5b9b4e5bcbae88085|156314', 'continue': '-||'}

            while True:
                members = []
                params = {
                    "action": "query",
                    "list": "categorymembers",
                    "cmtitle": category,
                    "cmlimit": "50",
                    "format": "json"
                }
                if continue_param:
                    params.update(continue_param)
                
                try:
                    # Query game entries
                    retry = 0
                    max_retry = 10
                    while retry < max_retry:
                        try:
                            response = self.client.get(WIKI_API_URL, params=params).json()
                            members.extend(response.get("query", {}).get("categorymembers", []))
                            break
                        except Exception as e:
                            retry += 1
                            logging.warning(f"Failed to query game entries (attempt {retry}/{max_retry}): {str(e)}")
                            if retry >= max_retry:
                                raise

                    steam_ids = []
                    for member in members:
                        title = member["title"]
                        wiki_page_id = member["pageid"]
                        game_entry = {
                            'title': title,
                            'wiki_page_id': wiki_page_id,
                            'install_folder': None
                        }

                        # Process wikitext
                        retry = 0
                        max_retry = 10
                        while retry < max_retry:
                            try:
                                wikitext = self.fetch_wikitext(wiki_page_id)
                                parsed_entry = self.parse_wikitext(wikitext)
                                game_entry.update(parsed_entry)
                                break
                            except Exception as e:
                                retry += 1
                                logging.warning(f"Failed to process wikitext for {title} (attempt {retry}/{max_retry}): {str(e)}")
                                if retry >= max_retry:
                                    raise

                        if not any(save_paths for save_paths in game_entry['save_location'].values()):
                            logging.info(f"No save locations found: {title}")
                            continue
                        if game_entry['steam_id']:
                            steam_ids.append(int(game_entry['steam_id']))
                        self.save_entry(game_entry)

                        cnt += 1
                        logging.info(f"{cnt}. Saved in database: {title}")
                    
                    logging.info("Finding game installation folders...")

                    # Process steam database
                    retry = 0
                    max_retry = 10
                    while retry < max_retry:
                        try:
                            self.find_install_folder_name(steam_ids)
                            break
                        except (gevent.timeout.Timeout, Exception) as e:
                            retry += 1
                            logging.warning(f"Failed to fetch steam database (attempt {retry}/{max_retry}): {str(e)}")
                            if retry >= max_retry:
                                raise

                except (gevent.timeout.Timeout, Exception) as e:
                    logging.error(f"Error processing game entry for {title}: {str(e)}", exc_info=True)
                
                if "continue" in response:
                    continue_param = response["continue"]
                    logging.info("Continue parameter: %s", continue_param)
                else:
                    logging.info("All games fetched!")
                    break

        return members

    def fetch_wikitext(self, page_id):
        params = {
            "action": "parse",
            "pageid": page_id,
            "prop": "wikitext",
            "format": "json"
        }
        response = self.client.get(WIKI_API_URL, params=params).json()
        return response.get("parse", {}).get("wikitext", {}).get("*", "")

    def parse_wikitext(self, wikitext):
        entry = {
            'steam_id': None,
            'gog_id': None,
            'save_location': {'win': set(), 'reg': set(), 'mac': set(), 'linux': set()},
            'platform': set()
        }
        system_map = {
            'Registry': 'reg',
            'Windows': 'win',
            'Microsoft Store': 'win',
            'Steam': 'win',
            'GOG.com': 'win',
            'Ubisoft Connect': 'win',
            'Uplay': 'win',
            'Origin': 'win',
            'Epic Games Store': 'win',
            'Epic Games Launcher': 'win',
            'Amazon Games': 'win',
            'DOS': 'win',
            'PC booter': 'win',
            'OS X': 'mac',
            'Mac OS': 'mac',
            'Mac App Store': 'mac',
            'Linux': 'linux'
        }
        platform_map = {
            'steam': 'Steam',
            'steam-sub': 'Steam',
            'microsoft store': 'Xbox',
            'ms store': 'Xbox',
            'gog': 'GOG',
            'gog.com': 'GOG',
            'ubisoft store': 'Ubisoft',
            'ubisoft': 'Ubisoft',
            'uplay': 'Ubisoft',
            'origin': 'EA',
            'ea desktop': 'EA',
            'epic games store': 'Epic',
            'epic': 'Epic',
            'egs': 'Epic',
            'battle.net': 'Blizzard',

            # Below are ignored platform
            'official': '',
            'offical': '',
            'retail': '',
            'publisher': '',
            'developer': '',
            'amazon.co.uk': '',
            'bethesda.net': '',
            'zoom': '',
            'zoom platform': '',
            'macapp': '',
            'mac app store': '',
            'oculus': '',
            'oculus store': '',
            'amazon': '',
            'amazon.com': '',
            'gmg': '',
            'humble': '',
            'humble store': '',
            'itch.io': '',
            'gamesplanet': '',
            'gamersgate': '',
            'viveport': '',
            'games for windows marketplace': '',
            'discord': '',
            'twitch': ''
        }

        wikicode = mwparserfromhell.parse(wikitext)

        # Extract steam id and gog id
        infobox_templates = wikicode.filter_templates(matches=lambda x: x.name.strip() == 'Infobox game')
        if infobox_templates:
            infobox = infobox_templates[0]
            if infobox.has('steam appid'):
                entry['steam_id'] = infobox.get('steam appid').value.strip()
            if infobox.has('gogcom id'):
                entry['gog_id'] = infobox.get('gogcom id').value.strip()
        
        # Extract available platforms
        availability_templates = wikicode.filter_templates(matches=lambda x: x.name.strip() == 'Availability/row')
        for template in availability_templates:
            raw_platform = template.params[0].strip()
            platform = platform_map.get(raw_platform.lower().replace("1=", "").strip(), "unknown")
            if platform and platform != "unknown":
                entry['platform'].add(platform)
            elif platform == "unknown":
                logging.warning(f"Unknown platform: {raw_platform}")

        # Extract save locations
        for template_name in ['Game data/config', 'Game data/saves']:
            templates = wikicode.filter_templates(matches=lambda x: x.name.strip() == template_name)
            for template in templates:
                # example of a "template": {{Game data/saves|Windows|{{p|game}}\mlc01\usr\save\|{{p|userprofile}}\Documents\mlc01\usr\save\{{Note|Legacy default location}}}}
                params = template.params
                system = params[0].strip()
                paths = params[1:]

                if system in system_map and any(path.strip() for path in paths):
                    for path in paths:
                        cleaned_path_nodes = []

                        for node in path.value.nodes:
                            if isinstance(node, mwparserfromhell.nodes.template.Template):
                                # Remove the "Note" and "citation needed" section, for instance: {{Note|Legacy default location}} or {{cn}}
                                if node.name.lower().strip() in ["note", "cn"]:
                                    continue
                                if len(node.params) > 0 and node.params[0].lower().strip() in ["hkcu", "hkey_current_user", "hklm", "hkey_local_machine", "wow64"]:
                                    system = "Registry"
                            elif any(key in str(node).lower().strip() for key in ["hkey_current_user", "hkey_local_machine"]):
                                system = "Registry"

                                if str(node).startswith("Registry: "):
                                    print(f"Anomaly game: {entry['steam_id']}")
                                    node = str(node).replace("Registry: ", "")
                            
                            # Some special cases
                            node_str = str(node).strip()
                            if '<ref>' in node_str and '</ref>' in node_str:
                                node = node_str.split('<ref>')[0] + node_str.split('</ref>')[1]

                            cleaned_path_nodes.append(str(node))
                        cleaned_path = "".join(cleaned_path_nodes).strip()

                        # Only keep the most general path, any subdirectories should not be separate paths
                        if cleaned_path:
                            save_location_key = system_map[system]
                            relative_paths = {p for p in entry['save_location'][save_location_key] if not os.path.isabs(p)}
                            absolute_paths = {p for p in entry['save_location'][save_location_key] if os.path.isabs(p)}

                            is_abs = os.path.isabs(cleaned_path)
                            should_add_path = True
                            cleaned_path_normalized = os.path.normpath(cleaned_path)
                            
                            paths_to_check = absolute_paths if is_abs else relative_paths
                            try:
                                for existing_path in paths_to_check:
                                    existing_path_normalized = os.path.normpath(existing_path)
                                    common_path = os.path.commonpath([existing_path_normalized, cleaned_path_normalized])

                                    if common_path == existing_path_normalized:
                                        should_add_path = False
                                        break
                                    if common_path == cleaned_path_normalized:
                                        entry['save_location'][save_location_key].remove(existing_path)

                            except ValueError as e:
                                if not str(e) == "Paths don't have the same drive":
                                    raise e

                            if should_add_path:
                                entry['save_location'][save_location_key].add(cleaned_path_normalized)

                if system not in system_map:
                    logging.warning(f"Unknown system: {system}")
        
        for os_key in entry['save_location']:
            entry['save_location'][os_key] = list(entry['save_location'][os_key])
        entry['platform'] = list(entry['platform'])

        return entry
    
    def find_install_folder_name(self, steam_ids):
        if steam_ids:
            client = SteamClient()
            client.anonymous_login()
            info = client.get_product_info(apps=steam_ids)

            apps_info = info.get('apps', {})
            for steam_id, app_data in apps_info.items():
                install_folder_name = app_data.get('config', {}).get('installdir', None)

                # Update "install_folder" in database
                if install_folder_name:
                    entry = self.find_entry_by_steam_id(steam_id)
                    if entry:
                        entry['install_folder'] = install_folder_name
                        self.save_entry(entry)
                        logging.info(f"Found installation folder for steam_id {steam_id}")
                    else:
                        logging.error(f"No entry found in database for steam_id {steam_id}")

    def create_tables(self):
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS games (
                    title TEXT PRIMARY KEY,
                    wiki_page_id INTEGER,
                    install_folder TEXT,
                    steam_id INTEGER,
                    gog_id INTEGER,
                    save_location TEXT,
                    platform TEXT
                )
            """)

    def save_entry(self, entry):
        with self.conn:
            self.conn.execute("""
                INSERT OR REPLACE INTO games
                (title, wiki_page_id, install_folder, steam_id, gog_id, save_location, platform)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                entry['title'],
                entry['wiki_page_id'],
                entry['install_folder'],
                entry.get('steam_id'),
                entry.get('gog_id'),
                json.dumps(entry.get('save_location')),
                json.dumps(entry.get('platform'))
            ))
    
    def find_entry_by_steam_id(self, steam_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM games WHERE steam_id = ?", (steam_id,))
        row = cursor.fetchone()
        cursor.close()
        if row:
            return {
                'title': row[0],
                'wiki_page_id': row[1],
                'install_folder': row[2],
                'steam_id': row[3],
                'gog_id': row[4],
                'save_location': json.loads(row[5]) if row[5] else None,
                'platform': json.loads(row[6]) if row[6] else None
            }
        return None


def main():
    fetcher = DatabaseFetcher()
    fetcher.fetch_all_category_members()

if __name__ == "__main__":
    main()
